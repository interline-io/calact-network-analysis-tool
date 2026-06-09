<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid" style="padding: 16px 24px; max-width: 1000px;">
        <h1 class="title">
          Jobs
        </h1>

        <div class="cal-jobs-index-actions">
          <cat-button :disabled="loading" icon-left="reload" @click="refresh">
            {{ loading ? 'Refreshing…' : 'Refresh' }}
          </cat-button>
          <span v-if="lastRefreshedAt" class="has-text-grey is-size-7">
            Last refreshed: {{ lastRefreshedAt.toLocaleTimeString() }}
          </span>
        </div>

        <cat-notification v-if="error" variant="danger">
          {{ error }}
        </cat-notification>

        <cat-table
          :data="rows"
          striped
          hoverable
          caption="Recent jobs"
          caption-hidden
        >
          <template #columns>
            <cat-table-column field="state" label="State" />
            <cat-table-column field="heading" label="Job" />
            <cat-table-column field="queue" label="Queue" />
            <cat-table-column field="submitted_at" label="Submitted" />
            <cat-table-column field="timing" label="Duration" />
          </template>
          <template #default="{ row }">
            <td>
              <cat-tag :variant="jobStateVariant(row.state)">
                {{ capitalize(row.state) }}
              </cat-tag>
            </td>
            <td>
              <nuxt-link v-if="row.detailPath" :to="row.detailPath">
                {{ jobHeading(row.queue, row) }}
              </nuxt-link>
              <template v-else>
                {{ jobHeading(row.queue, row) }}
              </template>
            </td>
            <td>{{ row.queue }}</td>
            <td>{{ fmtDate(row.submitted_at, 'yyyy-MM-dd HH:mm') }}</td>
            <td>{{ jobTiming(row, now) }}</td>
          </template>
          <template #empty>
            <span v-if="loading">Loading…</span>
            <span v-else>No recent jobs. Jobs are pruned from the store after completion.</span>
          </template>
        </cat-table>
      </div>
    </template>
  </NuxtLayout>
</template>

<script setup lang="ts">
// NOTE: The job-status pages (this index and [queue]/[jobId].vue) plus the
// src/tl/jobs.ts helpers are largely generic over the tlv2 jobs API. In the
// future, consider moving them into a new tlv2-apps package so they can be
// reused across multiple projects.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useHead } from '#imports'
import { capitalize, fmtDate } from '~~/src/core'
import {
  JOB_TERMINAL_STATES,
  USER_JOB_QUEUES,
  fetchQueueJobs,
  jobHeading,
  jobStateVariant,
  jobTiming,
  type JobStatus,
} from '~~/src/tl'

definePageMeta({ layout: false })

useHead({ title: 'Jobs' })

const MAX_ROWS = 50
const AUTO_REFRESH_MS = 10000

interface JobRow extends JobStatus {
  queue: string
  key: string
  detailPath: string
}

const rows = ref<JobRow[]>([])
const error = ref('')
const loading = ref(false)
const lastRefreshedAt = ref<Date | null>(null)
const now = ref(new Date())

const anyActive = computed(() => rows.value.some(r => !JOB_TERMINAL_STATES.has(r.state)))

function toRow (queue: string, status: JobStatus, index: number): JobRow {
  const jobId = status.job?.id
  const idStr = jobId != null ? String(jobId) : ''
  return {
    ...status,
    queue,
    // job.id should always be present in list responses; index-fallback keeps
    // v-for keys unique if it ever isn't.
    key: idStr ? `${queue}/${idStr}` : `${queue}#${index}`,
    detailPath: idStr ? `/job-status/${encodeURIComponent(queue)}/${encodeURIComponent(idStr)}` : '',
  }
}

function submittedMs (s: JobStatus): number {
  const d = s.submitted_at ? new Date(s.submitted_at) : null
  return d && !isNaN(d.getTime()) ? d.getTime() : 0
}

async function refresh () {
  loading.value = true
  try {
    const results = await Promise.allSettled(
      USER_JOB_QUEUES.map(q => fetchQueueJobs(q))
    )
    const merged: JobRow[] = []
    const failures: string[] = []
    results.forEach((result, i) => {
      const queue = USER_JOB_QUEUES[i] ?? ''
      if (result.status === 'fulfilled') {
        merged.push(...result.value.map((s, j) => toRow(queue, s, j)))
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        failures.push(`${queue}: ${msg}`)
      }
    })
    merged.sort((a, b) => submittedMs(b) - submittedMs(a))
    rows.value = merged.slice(0, MAX_ROWS)
    error.value = failures.length > 0 ? `Failed to fetch some queues — ${failures.join('; ')}` : ''
    lastRefreshedAt.value = new Date()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    syncTimers()
  }
}

// Auto-refresh only while something is still running; the 1s ticker keeps
// "Running for Ns" live. Both stop when every listed job is terminal.
let refreshTimer: ReturnType<typeof setInterval> | null = null
let nowTimer: ReturnType<typeof setInterval> | null = null

function syncTimers () {
  if (anyActive.value) {
    if (refreshTimer == null) {
      refreshTimer = setInterval(() => { void refresh() }, AUTO_REFRESH_MS)
    }
    if (nowTimer == null) {
      nowTimer = setInterval(() => { now.value = new Date() }, 1000)
    }
  } else {
    stopTimers()
  }
}

function stopTimers () {
  if (refreshTimer != null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (nowTimer != null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
}

onMounted(() => { void refresh() })
onBeforeUnmount(() => { stopTimers() })
</script>

<style scoped>
.cal-jobs-index-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}
</style>
