<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid" style="padding: 16px 24px; max-width: 1000px;">
        <h1 class="title">
          Job status
        </h1>

        <div class="cal-job-status-header">
          <div>Queue: <code>{{ queue }}</code></div>
          <div>Job ID: <code>{{ jobId }}</code></div>
          <div>
            State:
            <strong>{{ stateLabel }}</strong>
          </div>
        </div>

        <cat-notification v-if="error" variant="danger">
          {{ error }}
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
              <cat-button :disabled="loading" @click="refreshNow">
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
import { capitalize } from '~~/src/core'

definePageMeta({ layout: false })

const route = useRoute()
const queue = computed(() => String(route.params.queue || ''))
const jobId = computed(() => String(route.params.jobId || ''))

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled'])
const POLL_INTERVAL_MS = 5000

const status = ref<any>(null)
const state = ref<string>('')
const error = ref<string>('')
const loading = ref(false)
const cancelling = ref(false)
const lastPolledAt = ref<Date | null>(null)
const terminal = computed(() => TERMINAL_STATES.has(state.value))
const stateLabel = computed(() => {
  if (!state.value) { return loading.value ? 'Loading…' : 'Unknown' }
  return capitalize(state.value)
})

let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling () {
  if (pollTimer != null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

// JobGet reads from postgres so it works from any pod, unlike the SSE /watch
// endpoint whose events only fire on the pod that processed the job.
async function fetchStatus () {
  if (!queue.value || !jobId.value) {
    error.value = 'Missing queue or job id'
    return
  }
  loading.value = true
  try {
    const res = await fetch(
      `/proxy/default/jobs/queues/${encodeURIComponent(queue.value)}/jobs/${encodeURIComponent(jobId.value)}`
    )
    const text = await res.text()
    if (!res.ok) {
      error.value = `${res.status} ${res.statusText} — ${text}`
      stopPolling()
      return
    }
    error.value = ''
    const parsed = JSON.parse(text)
    status.value = parsed
    state.value = parsed?.state || 'unknown'
    lastPolledAt.value = new Date()
    if (terminal.value) {
      stopPolling()
    } else {
      pollTimer = setTimeout(fetchStatus, POLL_INTERVAL_MS)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function refreshNow () {
  stopPolling()
  fetchStatus()
}

async function cancel () {
  if (!confirm(`Cancel job ${jobId.value}?`)) { return }
  cancelling.value = true
  try {
    const res = await fetch(
      `/proxy/default/jobs/queues/${encodeURIComponent(queue.value)}/jobs/${encodeURIComponent(jobId.value)}/cancel`,
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

onMounted(fetchStatus)
onBeforeUnmount(stopPolling)
</script>

<style scoped>
.cal-job-status-header {
  margin: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
