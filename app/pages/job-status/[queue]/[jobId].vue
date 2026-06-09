<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid" style="padding: 16px 24px; max-width: 1000px;">
        <nuxt-link to="/job-status" class="cal-job-status-back is-size-7">
          ← All jobs
        </nuxt-link>
        <h1 class="title">
          {{ heading }}
        </h1>

        <div class="cal-job-status-header">
          <div class="cal-job-status-field">
            <span>Queue:</span>
            <cat-safelink :text="queue" />
          </div>
          <div class="cal-job-status-field">
            <span>Job ID:</span>
            <cat-safelink :text="jobId" />
          </div>
          <div v-if="!notFound" class="cal-job-status-field">
            <span>State:</span>
            <cat-tag :variant="jobStateVariant(state)">
              {{ stateLabel }}
            </cat-tag>
          </div>
          <div v-if="timing" class="cal-job-status-field">
            {{ timing }}
          </div>
        </div>

        <cat-notification v-if="notFound" variant="warning">
          Job not found — it may have been completed and pruned from the job store.
        </cat-notification>
        <cat-notification v-else-if="error" variant="danger">
          {{ error }}
        </cat-notification>
        <cat-notification v-if="jobError" variant="danger">
          {{ jobError }}
        </cat-notification>

        <div class="cal-job-status-actions">
          <cat-button v-if="!terminal" variant="light" :disabled="loading || cancelling" @click="cancel">
            {{ cancelling ? 'Cancelling…' : 'Cancel job' }}
          </cat-button>
        </div>

        <cat-msg
          title="Advanced"
          variant="dark"
          expandable
          class="cal-job-status-advanced"
        >
          <div class="cal-job-status-advanced-body">
            <div class="cal-job-status-actions">
              <cat-button :disabled="loading" icon-left="reload" @click="refreshNow">
                Refresh now
              </cat-button>
            </div>
            <div v-if="lastPolledAt" class="has-text-grey is-size-7">
              Last polled: {{ lastPolledAt.toLocaleTimeString() }}
            </div>
            <pre v-if="status" class="cal-job-status-json">{{ JSON.stringify(status, null, 2) }}</pre>
          </div>
        </cat-msg>
      </div>
    </template>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '#imports'
import { capitalize } from '~~/src/core'
import {
  JOB_TERMINAL_STATES,
  JOBS_USE_SSE,
  jobApiPath,
  jobHeading,
  jobStateVariant,
  jobTiming,
  watchJob,
  type JobStatus,
  type WatchJobHandle,
} from '~~/src/tl'

definePageMeta({ layout: false })

const route = useRoute()
const queue = computed(() => String(route.params.queue || ''))
const jobId = computed(() => String(route.params.jobId || ''))

const status = ref<JobStatus | null>(null)
const state = ref<string>('')
const error = ref<string>('')
const notFound = ref(false)
const loading = ref(false)
const cancelling = ref(false)
const lastPolledAt = ref<Date | null>(null)
const now = ref(new Date())
const terminal = computed(() => JOB_TERMINAL_STATES.has(state.value))
const stateLabel = computed(() => {
  if (!state.value) { return loading.value ? 'Loading…' : 'Unknown' }
  return capitalize(state.value)
})

// Worker-reported failure message (distinct from `error`, which is a fetch/
// transport problem). Surfaced inline so failures don't require opening the
// Advanced JSON dump.
const jobError = computed(() => {
  const msg = status.value?.error?.trim()
  return msg ? `Job error: ${msg}` : ''
})

// Human-readable title derived from the queue and the job args (when the
// JobStatus has landed) — shared with the jobs index page.
const heading = computed(() => jobHeading(queue.value, status.value))

// Browser tab title: state-first so the tab strip shows progress at a glance.
useHead({
  title: () => `[${stateLabel.value}] ${heading.value}`,
})

// "Submitted 2s ago" / "Running for 18s" / "Ran for 45s" — shared with the
// jobs index page. Reads `now` so it ticks once per second while the job is
// still going.
const timing = computed(() => jobTiming(status.value, now.value))

let watchHandle: WatchJobHandle | null = null

function unsubscribe () {
  if (watchHandle != null) {
    watchHandle.unsubscribe()
    watchHandle = null
  }
}

// One-shot JobGet for the Advanced JSON dump and the initial snapshot.
// watchJob owns the live updates; this just refills the wrapper after
// terminal so the dump shows finished state.
async function fetchStatus () {
  if (!queue.value || !jobId.value) {
    error.value = 'Missing queue or job id'
    return
  }
  loading.value = true
  try {
    const res = await fetch(jobApiPath(queue.value, jobId.value))
    const text = await res.text()
    if (res.status === 404) {
      notFound.value = true
      error.value = ''
      return
    }
    if (!res.ok) {
      error.value = `${res.status} ${res.statusText} — ${text}`
      return
    }
    notFound.value = false
    error.value = ''
    const parsed = JSON.parse(text)
    status.value = parsed
    state.value = parsed?.state || 'unknown'
    lastPolledAt.value = new Date()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function start () {
  await fetchStatus()
  if (terminal.value || error.value || notFound.value) { return }
  unsubscribe()
  watchHandle = watchJob({
    queue: queue.value,
    jobId: jobId.value,
    useSSE: JOBS_USE_SSE,
    onState: (s) => {
      state.value = s
      lastPolledAt.value = new Date()
      if (JOB_TERMINAL_STATES.has(s)) {
        fetchStatus()
        stopNowTicker()
      }
    },
  })
}

function refreshNow () {
  fetchStatus()
}

async function cancel () {
  if (!confirm(`Cancel job ${jobId.value}?`)) { return }
  cancelling.value = true
  try {
    const res = await fetch(
      jobApiPath(queue.value, jobId.value, 'cancel'),
      { method: 'POST' }
    )
    if (!res.ok) {
      const text = await res.text()
      error.value = `Cancel failed: ${res.status} ${res.statusText} — ${text}`
      return
    }
    refreshNow()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    cancelling.value = false
  }
}

// 1s ticker so the `timing` computed updates while we wait. Stopped on
// terminal (no live duration to render) and on unmount.
let nowTimer: ReturnType<typeof setInterval> | null = null
function stopNowTicker () {
  if (nowTimer != null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
}
// Await start() so the synchronous terminal check below sees the real
// post-bootstrap state — otherwise a deep-link to an already-terminal job
// starts the ticker before the fetch resolves and never stops it (watchJob
// is not wired for terminal-at-mount, so onState never fires).
onMounted(async () => {
  await start()
  if (status.value && !terminal.value) {
    nowTimer = setInterval(() => { now.value = new Date() }, 1000)
  }
})
onBeforeUnmount(() => {
  unsubscribe()
  stopNowTicker()
})
</script>

<style scoped>
.cal-job-status-back {
  display: inline-block;
  margin-bottom: 8px;
}
.cal-job-status-header {
  margin: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cal-job-status-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cal-job-status-actions {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.cal-job-status-json {
  background: #fafafa;
  border: 1px solid var(--bulma-border, #e0e0e0);
  border-radius: 4px;
  padding: 12px;
  margin-top: 12px;
  font-size: 0.85rem;
  overflow: auto;
  max-height: 70vh;
}
.cal-job-status-advanced {
  margin-top: 24px;
}
.cal-job-status-advanced-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
