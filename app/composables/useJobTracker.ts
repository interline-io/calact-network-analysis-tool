import { useStorage } from '@vueuse/core'
import { computed, type ComputedRef, type Ref } from 'vue'
import { JOB_TERMINAL_STATES, JOBS_USE_SSE, watchJob, type WatchJobHandle } from '~~/src/tl'

// Jobs started from this browser, persisted to localStorage so the badge and
// jobs list survive the open-in-new-tab handoff from the Feed Archive modal
// and stay in sync across tabs (useStorage listens to the `storage` event).
export interface TrackedJob {
  queue: string
  jobId: string
  state: string
  startedAtMs: number
  updatedAtMs: number
}

// Entries that haven't been updated in this long are excluded from the badge
// count — covers jobs whose watch 404'd (pruned server-side) before reaching
// a terminal state, which would otherwise read "running" forever.
const STALE_ACTIVE_MS = 24 * 60 * 60 * 1000
// Terminal entries older than this are pruned from localStorage.
const PRUNE_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TRACKED_JOBS = 50

const STORAGE_KEY = 'cal-tracked-jobs'

// Module-level singleton so main-header, the feed-version picker, and the
// jobs index page share one list and one set of watchers per tab.
let trackedJobs: Ref<TrackedJob[]> | null = null
const watchHandles = new Map<string, WatchJobHandle>()

function jobKey (queue: string, jobId: string): string {
  return `${queue}/${jobId}`
}

function isActive (j: TrackedJob, nowMs: number): boolean {
  return !JOB_TERMINAL_STATES.has(j.state) && (nowMs - j.updatedAtMs) < STALE_ACTIVE_MS
}

function prune (jobs: TrackedJob[], nowMs: number): TrackedJob[] {
  return jobs
    .filter(j => !(JOB_TERMINAL_STATES.has(j.state) && (nowMs - j.updatedAtMs) > PRUNE_TERMINAL_MS))
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, MAX_TRACKED_JOBS)
}

export interface JobTracker {
  activeCount: ComputedRef<number>
  registerJob: (job: { queue: string, jobId: string }) => void
  ensureWatching: () => void
}

export const useJobTracker = (): JobTracker => {
  if (import.meta.server) {
    return {
      activeCount: computed(() => 0),
      registerJob: () => {},
      ensureWatching: () => {},
    }
  }

  if (trackedJobs == null) {
    trackedJobs = useStorage<TrackedJob[]>(STORAGE_KEY, [])
  }
  const jobs = trackedJobs

  // Rewrite one entry, producing a new array so useStorage reserializes and
  // other tabs receive the storage event. The poller reports the state every
  // tick, so skip the write (and the cross-tab event) when nothing changed.
  function updateJob (queue: string, jobId: string, state: string) {
    const entry = jobs.value.find(j => j.queue === queue && j.jobId === jobId)
    if (!entry || entry.state === state) { return }
    jobs.value = jobs.value.map(j =>
      j === entry ? { ...j, state, updatedAtMs: Date.now() } : j)
  }

  function startWatching (queue: string, jobId: string) {
    const key = jobKey(queue, jobId)
    if (watchHandles.has(key)) { return }
    const handle = watchJob({
      queue,
      jobId,
      useSSE: JOBS_USE_SSE,
      onState: (state) => {
        updateJob(queue, jobId, state)
        if (JOB_TERMINAL_STATES.has(state)) {
          watchHandles.delete(key)
        }
      },
    })
    watchHandles.set(key, handle)
  }

  function registerJob (job: { queue: string, jobId: string }) {
    const nowMs = Date.now()
    const entry: TrackedJob = {
      queue: job.queue,
      jobId: job.jobId,
      state: 'queued',
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
    }
    const rest = jobs.value.filter(j => !(j.queue === job.queue && j.jobId === job.jobId))
    jobs.value = prune([entry, ...rest], nowMs)
    startWatching(job.queue, job.jobId)
  }

  // Start watchers for any non-terminal tracked jobs not already watched in
  // this tab — covers the new-tab handoff and tabs that outlive the
  // originating one. Also prunes old terminal entries.
  function ensureWatching () {
    const nowMs = Date.now()
    const pruned = prune(jobs.value, nowMs)
    if (pruned.length !== jobs.value.length) {
      jobs.value = pruned
    }
    for (const j of jobs.value) {
      if (isActive(j, nowMs)) {
        startWatching(j.queue, j.jobId)
      }
    }
  }

  const activeCount = computed(() => {
    const nowMs = Date.now()
    return jobs.value.filter(j => isActive(j, nowMs)).length
  })

  return { activeCount, registerJob, ensureWatching }
}
