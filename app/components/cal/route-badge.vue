<template>
  <span
    class="cal-route-badge"
    :class="{ 'cal-route-badge-truncated': truncate }"
    :style="style"
    :title="title"
  >{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// A route's short name in a chip of its GTFS colors, as www draws route chips;
// neutral where the feed gives no color.
const props = defineProps<{
  label: string
  // GTFS route_color / route_text_color: hex without the '#'.
  color?: string | null
  textColor?: string | null
  title?: string
  // Ellipsize a long name to the width available.
  truncate?: boolean
}>()

const style = computed(() => {
  if (!props.color) {
    return {}
  }
  return {
    background: `#${props.color}`,
    color: props.textColor ? `#${props.textColor}` : '#fff',
  }
})
</script>

<style scoped lang="scss">
.cal-route-badge {
  display: inline-block;
  min-width: 1.75em;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bulma-scheme-main-ter);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;

  &.cal-route-badge-truncated {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }
}
</style>
