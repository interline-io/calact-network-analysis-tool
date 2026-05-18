// Shared subscription helper and types for the tlv2 jobs API. Used by the
// job-status page, the feed-version picker, and the debug-jobs page so the
// proxy URL shape, SSE/poll switch, and wire types live in one place.

export const JOB_TERMINAL_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled'])

// Single toggle: true → /watch SSE; false → JobGet polling. Polling is
// pod-independent (reads postgres) and was the more reliable path during
// multi-pod river Subscribe debugging.
export const JOBS_USE_SSE = false

// Path builder for the tlv2-auth proxy → jobs API. Centralized so a future
// proxy-base or routing change is one edit. Pass jobId for per-job endpoints
// and `action` for `/cancel` or `/watch`.
export function jobApiPath (queue: string, jobId?: string, action?: 'cancel' | 'watch'): string {
  const q = encodeURIComponent(queue)
  if (!jobId) { return `/proxy/default/jobs/queues/${q}/jobs` }
  const id = encodeURIComponent(jobId)
  if (action) { return `/proxy/default/jobs/queues/${q}/jobs/${id}/${action}` }
  return `/proxy/default/jobs/queues/${q}/jobs/${id}`
}

// Wire types matching tlv2's JSON shapes. JobStatus is the JobGet payload;
// JobEvent is the per-event payload over SSE /watch. `args` is worker-
// specific so left as Record<string, unknown>.
export interface Job {
  kind: string
  args?: Record<string, unknown>
  opts?: {
    user_id?: string
    deadline?: string
    unique?: boolean
  }
}

export interface JobStatus {
  state: string
  job: Job
  submitted_at?: string
  started_at?: string
  finished_at?: string
  error?: string
  attempt?: number
}

export interface JobEvent {
  job_id: string
  state: string
  attempt?: number
  message?: string
  time: string
}

export interface WatchJobOptions {
  queue: string
  jobId: string
  useSSE: boolean
  pollIntervalMs?: number
  // Fires for every state update including the terminal one. `info.message`
  // carries the worker's error message on terminal failure (and is unset
  // otherwise). The handle is auto-unsubscribed after the terminal callback
  // returns, so callers don't need to call unsubscribe themselves for the
  // happy path.
  onState: (state: string, info?: WatchJobUpdate) => void
}

export interface WatchJobUpdate {
  message?: string
}

export interface WatchJobHandle {
  unsubscribe: () => void
}

export function watchJob (opts: WatchJobOptions): WatchJobHandle {
  const pollInterval = opts.pollIntervalMs ?? 2000
  const baseUrl = jobApiPath(opts.queue, opts.jobId)
  const watchUrl = jobApiPath(opts.queue, opts.jobId, 'watch')

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let eventSource: EventSource | null = null
  let stopped = false

  function unsubscribe () {
    stopped = true
    if (pollTimer != null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (eventSource != null) {
      eventSource.close()
      eventSource = null
    }
  }

  // Returns true when the new state is terminal; caller stops polling/SSE.
  // No-op once `stopped` is true — callers may race unsubscribe with an
  // in-flight fetch/SSE event and we don't want to deliver onState after
  // unsubscribe.
  function emit (state: string, message?: string): boolean {
    if (stopped || !state) { return false }
    opts.onState(state, message ? { message } : undefined)
    return JOB_TERMINAL_STATES.has(state)
  }

  if (opts.useSSE) {
    // Both backends behind the jobs API (River and Argo) emit only terminal
    // events through Watch — a freshly-opened SSE on a running job stays
    // silent until terminal. Bootstrap with a JobGet so callers see the
    // current state right away; SSE then takes over for terminal.
    // Intermediate queued→running transitions are not surfaced.
    void (async () => {
      try {
        const res = await fetch(baseUrl)
        if (res.status === 404) {
          // Job already pruned or never existed — don't bother with SSE.
          unsubscribe()
          return
        }
        if (res.ok) {
          const status = await res.json()
          if (emit(status?.state || '', status?.error)) {
            unsubscribe()
            return
          }
        }
      } catch {
        // Transient — fall through to SSE, which may still deliver terminal.
      }
      if (stopped) { return }
      const es = new EventSource(watchUrl)
      eventSource = es
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data)
          if (emit(evt?.state || '', evt?.message)) { unsubscribe() }
        } catch {
          // Malformed payload — ignore; subsequent events may recover.
        }
      }
      es.addEventListener('end', () => { unsubscribe() })
    })()
  } else {
    // Polling fallback — one-shot JobGet per tick.
    const tick = async () => {
      if (stopped) { return }
      let terminal = false
      try {
        const res = await fetch(baseUrl)
        if (res.status === 404) {
          // Permanent — job pruned or never existed. Stop polling rather
          // than retry forever.
          unsubscribe()
          return
        }
        if (res.ok) {
          const status = await res.json()
          terminal = emit(status?.state || 'unknown', status?.error)
        }
      } catch {
        // Transient errors fall through to the next tick.
      }
      if (terminal || stopped) {
        unsubscribe()
        return
      }
      pollTimer = setTimeout(tick, pollInterval)
    }
    tick()
  }

  return { unsubscribe }
}
