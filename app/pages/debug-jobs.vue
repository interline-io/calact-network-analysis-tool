<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid" style="padding: 16px 24px; max-width: 1000px;">
        <h1 class="title">
          Jobs API (debug)
        </h1>

        <div class="cal-jobs-controls">
          <cat-field label="Queue">
            <cat-select v-model="queue">
              <option v-for="q in KNOWN_QUEUES" :key="q" :value="q">
                {{ q }}
              </option>
            </cat-select>
          </cat-field>
          <cat-field label="States (comma-separated, optional)">
            <cat-input v-model="states" placeholder="queued,running,failed" />
          </cat-field>
          <cat-button :disabled="loading" @click="fetchJobs">
            {{ loading ? 'Loading…' : 'Fetch jobs' }}
          </cat-button>
          <cat-button variant="light" :disabled="loading" @click="fetchMe">
            Check my roles
          </cat-button>
        </div>

        <hr>

        <h2 class="subtitle">
          Submit a job
        </h2>
        <div class="cal-jobs-controls">
          <cat-field label="Queue">
            <cat-select v-model="submitQueue">
              <option v-for="q in KNOWN_QUEUES" :key="q" :value="q">
                {{ q }}
              </option>
            </cat-select>
          </cat-field>
          <cat-field label="Kind">
            <cat-input v-model="submitKind" placeholder="test-worker" />
          </cat-field>
        </div>
        <cat-field label="Args (JSON)">
          <textarea v-model="submitArgs" class="cal-jobs-textarea" rows="4" spellcheck="false" />
        </cat-field>
        <div class="cal-jobs-submit-actions">
          <cat-button variant="primary" :disabled="loading" @click="submitJob">
            {{ loading ? 'Submitting…' : 'Submit job' }}
          </cat-button>
          <cat-button variant="light" :disabled="loading" @click="runJob">
            {{ loading ? 'Running…' : 'Run immediately' }}
          </cat-button>
        </div>

        <hr>

        <cat-notification v-if="error" variant="danger">
          {{ error }}
        </cat-notification>

        <p v-if="response?.jobs" class="has-text-grey">
          {{ response.jobs.length }} job{{ response.jobs.length === 1 ? '' : 's' }} returned
        </p>

        <pre v-if="response" class="cal-jobs-json">{{ JSON.stringify(response, null, 2) }}</pre>
      </div>
    </template>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { jobApiPath } from '~~/src/tl'

definePageMeta({ layout: false })

// Mirrors the queueWorkers map in tlv2/internal/mwconfig/jobs.go.
const KNOWN_QUEUES = [
  'default',
  'set-active',
  'static-fetch',
  'feed-version-import',
  'feed-version-unimport',
  'rt-fetch',
  'gbfs-fetch',
] as const

const queue = ref<typeof KNOWN_QUEUES[number]>('rt-fetch')
const states = ref('')
const submitQueue = ref<typeof KNOWN_QUEUES[number]>('default')
const submitKind = ref('test-worker')
// TestWorker args — see tlv2/internal/workers/workers.go.
const submitArgs = ref('{\n  "duration": "10s",\n  "log_interval": "2s",\n  "message": "debug"\n}')
const response = ref<any>(null)
const error = ref<string>('')
const loading = ref(false)

async function callProxy (url: string, init: RequestInit = {}) {
  loading.value = true
  error.value = ''
  response.value = null
  try {
    const res = await fetch(url, init)
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — ${text}`)
    }
    response.value = JSON.parse(text)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function fetchJobs () {
  // jobApiPath hits the tlv2-auth proxy: /proxy/{backend}/{...upstreamPath}.
  // Backend "default" → runtimeConfig.tlv2.proxyBase.default (the tlv2 base).
  const qs = states.value ? `?states=${encodeURIComponent(states.value)}` : ''
  await callProxy(`${jobApiPath(queue.value)}${qs}`)
}

async function fetchMe () {
  await callProxy('/proxy/default/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ me { id email roles } }' }),
  })
}

function parseSubmitArgs (): unknown | undefined {
  try {
    return submitArgs.value.trim() ? JSON.parse(submitArgs.value) : {}
  } catch (e) {
    error.value = `Args JSON parse error: ${e instanceof Error ? e.message : String(e)}`
    return undefined
  }
}

async function submitJob () {
  const args = parseSubmitArgs()
  if (args === undefined) { return }
  await callProxy(jobApiPath(submitQueue.value), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: submitKind.value, args }),
  })
  const jobId = response.value?.job?.id
  if (jobId) {
    window.open(
      `/job-status/${encodeURIComponent(submitQueue.value)}/${encodeURIComponent(String(jobId))}`,
      '_blank',
      'noopener',
    )
  }
}

// POST /jobs/run runs the worker synchronously (no queue, no tracking) and
// returns the final JobStatus. Nothing to open in a tab — show inline.
async function runJob () {
  const args = parseSubmitArgs()
  if (args === undefined) { return }
  await callProxy('/proxy/default/jobs/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: submitKind.value, args }),
  })
}
</script>

<style scoped>
.cal-jobs-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin: 16px 0;
  flex-wrap: wrap;
}
.cal-jobs-json {
  background: #fafafa;
  border: 1px solid var(--bulma-border, #e0e0e0);
  border-radius: 4px;
  padding: 12px;
  margin-top: 12px;
  font-size: 0.85rem;
  overflow: auto;
  max-height: 70vh;
}
.cal-jobs-textarea {
  width: 100%;
  font-family: monospace;
  padding: 8px;
  border: 1px solid var(--bulma-border, #e0e0e0);
  border-radius: 4px;
}
.cal-jobs-submit-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
