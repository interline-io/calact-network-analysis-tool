<template>
  <div class="cal-census-details-actions">
    <cat-button
      size="small"
      icon-left="content-copy"
      @click="copyText(String(row.geoid))"
    >
      Copy geoid
    </cat-button>
    <cat-button
      size="small"
      icon-left="code-json"
      @click="copyJson(row)"
    >
      Copy JSON
    </cat-button>
    <span v-if="copiedMessage" class="cal-census-details-actions-flash">
      {{ copiedMessage }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  row: Record<string, unknown>
}>()

const copiedMessage = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function flash (msg: string) {
  copiedMessage.value = msg
  if (copiedTimer) { clearTimeout(copiedTimer) }
  copiedTimer = setTimeout(() => { copiedMessage.value = '' }, 2000)
}

async function copyText (text: string) {
  try {
    await navigator.clipboard.writeText(text)
    flash(`Copied: ${text}`)
  } catch (err) {
    console.warn('clipboard write failed', err)
  }
}

async function copyJson (row: Record<string, unknown>) {
  const clean = Object.fromEntries(
    Object.entries(row).filter(([k]) => !k.startsWith('_')),
  )
  await copyText(JSON.stringify(clean, null, 2))
}
</script>

<style scoped lang="scss">
.cal-census-details-actions-flash {
  margin-left: 8px;
  color: var(--bulma-success);
  font-size: 0.85em;
}
</style>
