<template>
  <div class="cal-census-details-actions">
    <cat-button
      size="small"
      icon-left="content-copy"
      @click="$emit('copyText', String(row.geoid))"
    >
      Copy geoid
    </cat-button>
    <cat-button
      size="small"
      icon-left="code-json"
      @click="$emit('copyJson', row)"
    >
      Copy JSON
    </cat-button>
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
