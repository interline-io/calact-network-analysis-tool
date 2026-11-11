<template>
  <div class="content is-small">
    <p class="mb-1">
      {{ routes.length }} hidden:
    </p>
    <ul class="mt-0">
      <li v-for="c of routes" :key="c.route.id">
        <strong>{{ c.route.agencyName }}: {{ c.route.name }}</strong>
        from <code>{{ c.route.feedOnestopId }}</code>,
        {{ tripsLabel(c) }}
        {{ keptNames(c) }} from <code>{{ c.kept[0]?.feedOnestopId }}</code>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { CollapsedRouteSummary } from '~~/src/scenario'

// The route copies the duplicate route collapse hid, each with the copy it
// was hidden behind.
defineProps<{
  routes: CollapsedRouteSummary[]
}>()

// Completes "<route> from <feed>, … <kept route> from <feed>", with the
// trips the API matched over the compared dates.
function tripsLabel (c: CollapsedRouteSummary): string {
  if (c.trips > 0 && c.matchedTrips >= c.trips) {
    return `all ${c.trips} of its trips also run by`
  }
  return `${c.matchedTrips} of its ${c.trips} trips also run by`
}

// The kept copies' names, once each: usually one route, sometimes several
// rows of one route in the kept feed.
function keptNames (c: CollapsedRouteSummary): string {
  return [...new Set(c.kept.map(k => k.name))].join(', ')
}
</script>
