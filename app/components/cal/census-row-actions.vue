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
  </div>
</template>

<script setup lang="ts">
import { useToastNotification } from '~/composables/useToastNotification'

defineProps<{
  row: Record<string, unknown>
}>()

const { showToast } = useToastNotification()

async function copyText (text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied: ${text}`)
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
