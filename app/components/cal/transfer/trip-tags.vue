<template>
  <span class="cal-transfer-trip-tags has-text-grey">
    <cat-tooltip
      v-for="tag of tags"
      :key="tag.label"
      :text="`${tag.label}: ${tag.title}`"
    >
      <cat-icon size="small" :icon="ICONS[tag.kind]" :class="{ 'cal-transfer-trip-tag-partial': tag.partial }" /><span class="is-sr-only">{{ tag.label }}</span>
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
  back: 'arrow-u-left-top',
  same: 'arrow-right-thick',
}
</script>

<style scoped lang="scss">
.cal-transfer-trip-tags {
  display: inline-flex;
  vertical-align: middle;
}

.cal-transfer-trip-tag-partial {
  opacity: 0.5;
}
</style>
