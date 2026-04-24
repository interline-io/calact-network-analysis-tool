<template>
  <div class="cal-census-details-actions">
    <button
      type="button"
      class="button is-small"
      title="Copy geoid to clipboard"
      @click="$emit('copyText', String(row.geoid))"
    >
      <cat-icon icon="content-copy" size="small" /> geoid
    </button>
    <button
      type="button"
      class="button is-small"
      title="Copy full row as JSON"
      @click="$emit('copyJson', row)"
    >
      <cat-icon icon="code-json" size="small" /> JSON
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  row: Record<string, unknown>
}>()

defineEmits<{
  copyText: [text: string]
  copyJson: [row: Record<string, unknown>]
}>()
</script>
