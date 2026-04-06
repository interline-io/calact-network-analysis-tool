<template>
  <div class="cal-route-icon">
    <span class="cal-route-icon-icon">
      <cat-icon :icon="routeTypeIcon" />
    </span>
    <span v-if="routeShortName" class="cal-route-icon-short-name">{{ routeShortName }}</span>
    <span v-if="routeLongName && routeShortName != routeLongName">
      {{ routeLongName }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  routeType?: number | null
  routeShortName?: string | null
  routeLongName?: string | null
}>(), {
  routeType: null,
  routeShortName: null,
  routeLongName: null,
})

// Map extended GTFS route types to basic types
function getBasicRouteTypeCode (routeType: number): number {
  if (routeType >= 100) {
    return Math.floor(routeType / 100)
  }
  return routeType
}

const ROUTE_TYPE_ICONS: Record<number, string> = {
  0: 'tram',
  1: 'subway',
  2: 'train',
  3: 'bus',
  4: 'ferry',
  5: 'tram',
  6: 'gondola',
  7: 'tram',
  11: 'tram',
  12: 'train',
}

const routeTypeIcon = computed(() => {
  if (props.routeType === null || props.routeType === undefined) {
    return ''
  }
  const code = getBasicRouteTypeCode(props.routeType)
  return ROUTE_TYPE_ICONS[code] || ''
})
</script>

<style scoped>
.cal-route-icon {
  overflow: hidden;
  padding: 0;
  margin: 0;
  margin-bottom: 10px;
}

.cal-route-icon .cal-route-icon-short-name {
  display: inline-block;
  padding: 4px 8px;
  margin: 0 4px 0 0;
  outline: solid 1px #ccc;
  outline-offset: -1px;
  border-radius: 5px;
}

.cal-route-icon .cal-route-icon-icon {
  display: inline-block;
  width: 26px;
  text-align: center;
  position: relative;
  top: 3px;
}
</style>
