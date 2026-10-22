<template>
  <span class="cal-transfer-trip-tags">
    <cat-tooltip
      v-for="tag of tags"
      :key="tag.label"
      :text="`${tag.label}: ${tag.title}`"
      class="cal-transfer-trip-tag"
      :class="{ 'cal-transfer-trip-tag-partial': tag.partial }"
    >
      <cat-icon size="small" :icon="ICONS[tag.kind]" /><span class="is-sr-only">{{ tag.label }}</span>
    </cat-tooltip>
  </span>
</template>

<script setup lang="ts">
import type { TransferTripTag } from '~~/src/scenario/report/transfers'

// A trip's tags as icons, each named and explained in its tooltip; faded where
// a tag holds for only some of the trips.
defineProps<{
  tags: TransferTripTag[]
}>()

const ICONS: Record<TransferTripTag['kind'], string> = {
  ends: 'arrow-collapse-right',
  starts: 'arrow-expand-right',
  short: 'ray-start-end',
  turnback: 'arrow-u-left-top',
}
</script>

<style scoped lang="scss">
.cal-transfer-trip-tags {
  display: inline-flex;
  gap: 0.1em;
  vertical-align: middle;
  color: var(--bulma-text-weak);
}

.cal-transfer-trip-tag-partial :deep(.icon) {
  opacity: 0.5;
}
</style>
