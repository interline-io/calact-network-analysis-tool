<template>
  <!-- The transfer stops: a map to pick them by location, and a list by
       operator of the stops in view and those picked. -->
  <section class="p-5" aria-label="Stops and platforms">
    <div class="columns">
      <cal-transfer-stops-map
        v-model="stops"
        class="column is-three-fifths"
        :stops="mapStops"
        :routes="mapRoutes"
        :extent="extent"
        :fit-key="fitKey"
        :highlight="rowHover"
        @view="view = $event"
        @hover="mapHover = $event"
      />
      <div class="column cal-transfer-stops-side">
        <div class="cal-transfer-stops-list" role="group" aria-label="Stops">
          <div class="is-flex is-align-items-baseline is-gap-1.5 mb-2">
            <strong>{{ stops.length }} {{ stops.length === 1 ? 'stop' : 'stops' }} picked</strong>
            <!-- Both always shown, at the row's end, so neither takes the
                 other's place under the pointer. -->
            <button type="button" class="cal-link-button ml-auto" :disabled="!listed.some(s => !picked.has(s.id))" @click="selectListed">
              Select all
            </button>
            <button type="button" class="cal-link-button" :disabled="stops.length === 0" @click="unselectAll">
              Unselect all
            </button>
          </div>
          <div v-for="group of groups" :key="group.operator" class="mb-3">
            <div class="has-text-weight-semibold has-text-grey mb-1">
              {{ group.operator || 'Unknown operator' }}
            </div>
            <ul>
              <li
                v-for="s of group.stops"
                :key="s.id"
                :class="{ 'cal-transfer-stops-hovered': mapHover === s.id }"
                @mouseenter="rowHover = s.id"
                @mouseleave="rowHover = undefined"
              >
                <cat-checkbox class="is-flex" :model-value="picked.has(s.id)" @update:model-value="setPicked(s.id, !!$event)">
                  <!-- The map's shapes: a circle for a stop, a square for a
                       platform. -->
                  <cat-icon size="small" :icon="s.platform ? 'square-rounded-outline' : 'circle-outline'" v-bind="{ title: s.platform ? 'Platform in a station' : 'Stop' }" />
                  <span class="cal-transfer-stops-clip" :title="s.name">{{ s.name }}</span>
                  <span v-if="s.platform" class="is-sr-only">, platform</span>
                  <span class="cal-transfer-stops-clip cal-transfer-stops-routes has-text-grey" :title="s.routes">{{ s.routes }}</span>
                </cat-checkbox>
              </li>
            </ul>
          </div>
          <p v-if="groups.length === 0" class="has-text-grey">
            No stops in view.
          </p>
        </div>
        <!-- Stops close to those picked but not picked, as a station's stops
             on another feed that its cluster left out. Below the list, so the
             list stays put as this comes and goes. -->
        <p v-if="nearby.length > 0" class="notification mt-3">
          Nearby, not picked:
          <template v-for="(s, i) of nearby" :key="s.id">
            <button type="button" class="cal-link-button" :title="`Add ${s.name} (${s.operator})`" @click="setPicked(s.id, true)">
              {{ s.name }}
            </button><span class="has-text-grey"> ({{ s.operator || 'unknown operator' }})</span>{{ i < nearby.length - 1 ? ', ' : ' ' }}
          </template>
          <button v-if="nearby.length > 1" type="button" class="cal-link-button" @click="stops = [...stops, ...nearby.map(s => s.id)]">
            Add all
          </button>
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TransferMapRoute, TransferMapStop } from './stops-map.vue'
import { KM_PER_DEGREE, TRANSFER_PICKED_COLOR, compareNamesBlankLast, groupBy } from '~~/src/core'

const props = defineProps<{
  mapStops: TransferMapStop[]
  mapRoutes: TransferMapRoute[]
  // The query's area, which bounds the loaded stops.
  extent: GeoJSON.Feature[]
  // Frames the map anew when it changes: the subject.
  fitKey: string
}>()

const stops = defineModel<number[]>({ required: true })
// The stop under the pointer in the list, ringed on the map; and on the map,
// marked in the list.
const rowHover = ref<number>()
const mapHover = ref<number>()
const picked = computed(() => new Set(stops.value))

// Stops unpicked from the list stay listed until the map moves, so the list
// never shifts under the pointer.
const unpicked = ref(new Set<number>())

// The map's view (west, south, east, north), and the listed stops: those in
// view, plus those picked or just unpicked anywhere.
const view = ref<[number, number, number, number]>()
watch(view, () => {
  unpicked.value = new Set()
})
const listed = computed(() => props.mapStops.filter((s) => {
  if (picked.value.has(s.id) || unpicked.value.has(s.id)) {
    return true
  }
  const v = view.value
  return !!v && s.lon >= v[0] && s.lat >= v[1] && s.lon <= v[2] && s.lat <= v[3]
}))

// Stops within a short walk of one picked, not picked themselves, by name:
// those in a box around a picked stop, padded by the walk. A box is close
// enough for a suggestion and keeps distance measuring off the client.
const NEARBY_KM = 0.15
const nearby = computed(() => {
  const padLat = NEARBY_KM / KM_PER_DEGREE
  const boxes = props.mapStops
    .filter(s => picked.value.has(s.id))
    .map(c => ({ c, padLon: padLat / Math.cos((c.lat * Math.PI) / 180) }))
  return props.mapStops
    .filter(s => !picked.value.has(s.id) && boxes.some(({ c, padLon }) => Math.abs(s.lat - c.lat) <= padLat && Math.abs(s.lon - c.lon) <= padLon))
    .sort((a, b) => a.name.localeCompare(b.name))
})

// By operator, then name.
const groups = computed(() => [...groupBy(listed.value, s => s.operator)]
  .sort(([a], [b]) => compareNamesBlankLast(a, b))
  .map(([operator, list]) => ({ operator, stops: list.sort((a, b) => a.name.localeCompare(b.name)) })))

// Picks every listed stop.
function selectListed () {
  stops.value = [...new Set([...stops.value, ...listed.value.map(s => s.id)])]
}

function setPicked (id: number, on: boolean) {
  if (!on) {
    unpicked.value = new Set([...unpicked.value, id])
  }
  stops.value = on ? [...stops.value, id] : stops.value.filter(x => x !== id)
}

function unselectAll () {
  unpicked.value = new Set([...unpicked.value, ...stops.value])
  stops.value = []
}
</script>

<style scoped lang="scss">
// The list's column shrinks with the panel, cutting its rows short.
.cal-transfer-stops-side {
  min-width: 0;
}

.cal-transfer-stops-list {
  max-height: 17.5rem;
  overflow-y: auto;
}

li {
  padding: 0.25em 0.5em;
  border-radius: var(--bulma-radius-small);

  &:hover,
  &.cal-transfer-stops-hovered {
    background: color-mix(in srgb, v-bind(TRANSFER_PICKED_COLOR) 15%, transparent);
  }
}

.cal-transfer-stops-clip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// The routes take what room the name leaves.
.cal-transfer-stops-routes {
  flex: 1 1 0;
}
</style>
