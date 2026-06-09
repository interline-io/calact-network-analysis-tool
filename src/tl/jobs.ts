// Shared subscription helper and types for the tlv2 jobs API. Used by the
// job-status pages, the feed-version picker, and the debug-jobs page so the
// proxy URL shape, SSE/poll switch, and wire types live in one place.

import { formatDistance, formatDistanceStrict } from 'date-fns'

export const JOB_TERMINAL_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled'])

// Queues surfaced in the user-facing jobs list (/job-status). The full set of
// queues (rt-fetch, gbfs-fetch, ...) is system noise; debug-jobs.vue keeps its
// own KNOWN_QUEUES for the debug view.
export const USER_JOB_QUEUES = ['feed-version-import', 'feed-version-unimport'] as const

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
  // Present in API responses (JobGet, list, submit); absent on submit payloads.
  id?: string | number
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

// Human-readable title derived from the queue and the job args (when the
// JobStatus has landed). Pre-fetch we fall back to a queue-only label so
// headings aren't empty on first paint.
export function jobHeading (queue: string, status?: JobStatus | null): string {
  const fvId = status?.job?.args?.feed_version_id
  if (queue === 'feed-version-import') {
    return fvId != null ? `Importing feed version ${fvId}` : 'Importing feed version'
  }
  if (queue === 'feed-version-unimport') {
    return fvId != null ? `Unimporting feed version ${fvId}` : 'Unimporting feed version'
  }
  return queue ? `Job: ${queue}` : 'Job status'
}

function parseDateMaybe (s: string | null | undefined): Date | null {
  if (!s) { return null }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// "Submitted 2s ago" / "Running for 18s" / "Ran for 45s" depending on which
// timestamps are populated. Callers pass `now` so a ticking ref can drive
// live updates. Guards against invalid dates and clock skew (server timestamp
// slightly ahead of client clock) so the display never reads "in 2 seconds".
export function jobTiming (status: JobStatus | null | undefined, now: Date): string {
  if (!status) { return '' }
  const submittedAt = parseDateMaybe(status.submitted_at)
  const startedAt = parseDateMaybe(status.started_at)
  const finishedAt = parseDateMaybe(status.finished_at)
  if (finishedAt) {
    if (startedAt && finishedAt >= startedAt) {
      return `Ran for ${formatDistanceStrict(startedAt, finishedAt)}`
    }
    return `Finished ${formatDistance(finishedAt, now, { addSuffix: true })}`
  }
  if (startedAt) {
    const safeStart = startedAt <= now ? startedAt : now
    return `Running for ${formatDistanceStrict(safeStart, now)}`
  }
  if (submittedAt) {
    const safeSubmit = submittedAt <= now ? submittedAt : now
    return `Submitted ${formatDistanceStrict(safeSubmit, now, { addSuffix: true })}`
  }
  return ''
}

// One-shot list fetch for a queue. Returns [] on 404 (unknown/empty queue),
// throws on other non-OK responses so callers can surface the error.
export async function fetchQueueJobs (queue: string, states?: string): Promise<JobStatus[]> {
  const qs = states ? `?states=${encodeURIComponent(states)}` : ''
  const res = await fetch(`${jobApiPath(queue)}${qs}`)
  if (res.status === 404) { return [] }
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${text}`)
  }
  const parsed = JSON.parse(text)
  return Array.isArray(parsed?.jobs) ? parsed.jobs : []
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
