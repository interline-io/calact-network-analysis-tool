// Shared subscription helper for the tlv2 jobs API. Used by both the
// job-status page and the feed-version picker so the SSE/poll switch and
// the proxy URL shape live in one place.

export const JOB_TERMINAL_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled'])

export interface WatchJobOptions {
  queue: string
  jobId: string
  // true → /watch SSE; false → JobGet polling fallback. The polling path is
  // pod-independent (reads postgres) and was useful while debugging river
  // Subscribe's per-pod fanout.
  useSSE: boolean
  pollIntervalMs?: number
  // Fires for every state update including the terminal one. The handle is
  // auto-unsubscribed after the terminal callback returns, so callers don't
  // need to call unsubscribe themselves for the happy path.
  onState: (state: string) => void
}

export interface WatchJobHandle {
  unsubscribe: () => void
}

export function watchJob (opts: WatchJobOptions): WatchJobHandle {
  const pollInterval = opts.pollIntervalMs ?? 5000
  const baseUrl = `/proxy/default/jobs/queues/${encodeURIComponent(opts.queue)}/jobs/${encodeURIComponent(opts.jobId)}`

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
  function emit (state: string): boolean {
    if (!state) { return false }
    opts.onState(state)
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
        if (res.ok) {
          const status = await res.json()
          if (emit(status?.state || '')) {
            unsubscribe()
            return
          }
        }
      } catch {
        // Transient — fall through to SSE, which may still deliver terminal.
      }
      if (stopped) { return }
      const es = new EventSource(`${baseUrl}/watch`)
      eventSource = es
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data)
          if (emit(evt?.state || '')) { unsubscribe() }
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
        if (res.ok) {
          const status = await res.json()
          terminal = emit(status?.state || 'unknown')
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
