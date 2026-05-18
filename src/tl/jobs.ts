// Typed client for the tlv2 jobs HTTP API
// (transitland-lib/server/jobserver). Exposes list/status/watch/cancel as the
// read+monitor surface; submit lives elsewhere in the UI flow. All paths are
// relative — callers prepend the proxied tlv2 base via `useApiEndpoint`.

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export const TERMINAL_JOB_STATES: ReadonlyArray<JobState> = ['succeeded', 'failed', 'cancelled']

export function isTerminalState (s: JobState): boolean {
  return TERMINAL_JOB_STATES.includes(s)
}

// Mirrors transitland-lib/server/jobs.Args / Job. Args is intentionally `unknown`-typed
// per-field; consumers narrow it per `kind`.
export interface JobOpts {
  user_id?: string
  deadline?: string
  unique?: boolean
}

export interface Job {
  id: string
  kind: string
  args: Record<string, unknown>
  opts: JobOpts
}

export interface JobStatus {
  state: JobState
  job: Job
  submitted_at: string
  started_at?: string
  finished_at?: string
  error?: string
  attempt?: number
}

export interface JobEvent {
  job_id: string
  state: JobState
  attempt?: number
  message?: string
  time: string
}

export interface ListJobsResponse {
  jobs: JobStatus[]
}

export interface ListJobsOptions {
  states?: JobState[]
  kind?: string
  userId?: string
  limit?: number
  offset?: number
  signal?: AbortSignal
}

// Queue names match the worker kinds in tlv2/internal/workers.
export const IMPORT_QUEUE = 'feed-version-import'
export const UNIMPORT_QUEUE = 'feed-version-unimport'

function queuePath (queue: string): string {
  return `/jobs/queues/${encodeURIComponent(queue)}/jobs`
}

async function readJson<T> (res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`jobs api: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`)
  }
  return res.json() as Promise<T>
}

export async function listJobs (apiBase: string, queue: string, opts: ListJobsOptions = {}): Promise<JobStatus[]> {
  const params = new URLSearchParams()
  if (opts.states && opts.states.length > 0) { params.set('states', opts.states.join(',')) }
  if (opts.kind) { params.set('kind', opts.kind) }
  if (opts.userId) { params.set('user_id', opts.userId) }
  if (opts.limit != null) { params.set('limit', String(opts.limit)) }
  if (opts.offset != null) { params.set('offset', String(opts.offset)) }
  const qs = params.toString()
  const url = `${apiBase}${queuePath(queue)}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { signal: opts.signal })
  const body = await readJson<ListJobsResponse>(res)
  return body.jobs || []
}

export async function getJobStatus (apiBase: string, queue: string, jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const res = await fetch(`${apiBase}${queuePath(queue)}/${encodeURIComponent(jobId)}`, { signal })
  return readJson<JobStatus>(res)
}

export async function cancelJob (apiBase: string, queue: string, jobId: string): Promise<void> {
  const res = await fetch(`${apiBase}${queuePath(queue)}/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '')
    throw new Error(`jobs api: cancel failed ${res.status}${text ? ` — ${text}` : ''}`)
  }
}

// watchJob opens an SSE stream and yields JobEvents until terminal or
// disconnect. Returns a disposer that closes the underlying EventSource.
// Note: EventSource cannot set custom headers — auth must come from cookies
// (the tlv2-auth proxy session cookie satisfies this).
export interface WatchHandle {
  close: () => void
}

export function watchJob (
  apiBase: string,
  queue: string,
  jobId: string,
  handlers: {
    onEvent?: (ev: JobEvent) => void
    onError?: (err: unknown) => void
    onClose?: () => void
  }
): WatchHandle {
  const url = `${apiBase}${queuePath(queue)}/${encodeURIComponent(jobId)}/watch`
  const es = new EventSource(url, { withCredentials: true })
  let closed = false
  const close = () => {
    if (closed) { return }
    closed = true
    es.close()
    handlers.onClose?.()
  }
  es.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as JobEvent
      handlers.onEvent?.(parsed)
      if (parsed.state && isTerminalState(parsed.state)) {
        close()
      }
    } catch (err) {
      handlers.onError?.(err)
    }
  }
  es.addEventListener('end', () => { close() })
  es.onerror = (ev) => {
    handlers.onError?.(ev)
    // EventSource auto-reconnects on transient failures; only close on a
    // permanent end (handled by the 'end' event above).
  }
  return { close }
}

// Convenience: read the feed_version_id arg from a job (the import/unimport
// workers serialize it as a JSON number).
export function feedVersionIdFromJob (status: JobStatus): number | undefined {
  const v = status.job?.args?.feed_version_id
  return typeof v === 'number' ? v : undefined
}
