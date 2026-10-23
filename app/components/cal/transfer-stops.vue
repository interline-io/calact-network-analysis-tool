<template>
  <!-- The stops the transfers are at: on a map to pick by where they are,
       and as a list, by operator, of those in the map's view and those
       picked. -->
  <section class="cal-transfer-stops" aria-label="Stops and platforms">
    <cal-transfer-stops-map
      v-model="stops"
      :stops="mapStops"
      :routes="mapRoutes"
      :extent="extent"
      :fit-key="fitKey"
      :highlight="rowHover"
      @view="view = $event"
      @hover="mapHover = $event"
    />
    <div class="cal-transfer-stops-list" role="group" aria-label="Stops">
      <div class="cal-transfer-stops-head">
        <span>{{ stops.length }} {{ stops.length === 1 ? 'stop' : 'stops' }} picked</span>
        <button v-if="listed.some(s => !picked.has(s.id))" type="button" class="cal-transfer-stops-link" @click="selectListed">
          Select all
        </button>
        <button v-if="stops.length > 0" type="button" class="cal-transfer-stops-link" @click="stops = []">
          Unselect all
        </button>
      </div>
      <!-- Stops close to those picked but not picked, as a station's stops
           on another feed that its cluster left out. -->
      <p v-if="nearby.length > 0" class="cal-transfer-stops-nearby">
        Nearby, not picked:
        <template v-for="(s, i) of nearby" :key="s.id">
          <button type="button" class="cal-transfer-stops-link" :title="`Add ${s.name} (${s.operator})`" @click="setPicked(s.id, true)">
            {{ s.name }}
          </button><span class="cal-transfer-stops-nearby-operator"> ({{ s.operator || 'unknown operator' }})</span>{{ i < nearby.length - 1 ? ', ' : ' ' }}
        </template>
        <button v-if="nearby.length > 1" type="button" class="cal-transfer-stops-link" @click="stops = [...stops, ...nearby.map(s => s.id)]">
          Add all
        </button>
      </p>
      <div v-for="group of groups" :key="group.operator" class="cal-transfer-stops-group">
        <div class="cal-transfer-stops-operator">
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
            <cat-checkbox :model-value="picked.has(s.id)" @update:model-value="setPicked(s.id, !!$event)">
              <span
                :class="s.platform ? 'cal-transfer-stops-shape-platform' : 'cal-transfer-stops-shape-stop'"
                :title="s.platform ? 'Platform in a station' : 'Stop'"
              />
              <span class="cal-transfer-stops-name" :title="s.name">{{ s.name }}</span>
              <span v-if="s.platform" class="is-sr-only">, platform</span>
              <span class="cal-transfer-stops-routes" :title="s.routes">{{ s.routes }}</span>
            </cat-checkbox>
          </li>
        </ul>
      </div>
      <p v-if="groups.length === 0" class="cal-transfer-stops-empty">
        No stops in view.
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TransferMapRoute, TransferMapStop } from './transfer-stops-map.vue'
import { compareNamesBlankLast, groupBy } from '~~/src/core'
import { bearingAndDistance } from '~~/src/scenario'

const props = defineProps<{
  mapStops: TransferMapStop[]
  mapRoutes: TransferMapRoute[]
  // The query's area, which the stops were loaded from.
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

// The map's view, west, south, east, north; and the stops listed: those in
// it, and those picked wherever they are.
const view = ref<[number, number, number, number]>()
const listed = computed(() => props.mapStops.filter((s) => {
  if (picked.value.has(s.id)) {
    return true
  }
  const v = view.value
  return !!v && s.lon >= v[0] && s.lat >= v[1] && s.lon <= v[2] && s.lat <= v[3]
}))

// Stops within a short walk of one picked, not picked themselves, by name.
const NEARBY_KM = 0.15
const nearby = computed(() => {
  const chosen = props.mapStops.filter(s => picked.value.has(s.id))
  if (chosen.length === 0) {
    return []
  }
  // Only stops in the picked ones' box, padded by the walk (a degree of
  // latitude is about 111 km; of longitude, less), are measured.
  const pad = NEARBY_KM / 111
  const lats = chosen.map(c => c.lat)
  const padLon = pad / Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180)
  const lons = chosen.map(c => c.lon)
  const [west, east, south, north] = [Math.min(...lons) - padLon, Math.max(...lons) + padLon, Math.min(...lats) - pad, Math.max(...lats) + pad]
  return props.mapStops
    .filter(s => !picked.value.has(s.id) && s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north)
    .filter(s => chosen.some(c => bearingAndDistance([c.lon, c.lat], [s.lon, s.lat]).km <= NEARBY_KM))
    .sort((a, b) => a.name.localeCompare(b.name))
})

// By operator, then name.
const groups = computed(() => {
  return [...groupBy(listed.value, s => s.operator)]
    .sort(([a], [b]) => compareNamesBlankLast(a, b))
    .map(([operator, list]) => ({ operator, stops: list }))
})

// Every stop listed picked.
function selectListed () {
  stops.value = [...new Set([...stops.value, ...listed.value.map(s => s.id)])]
}

function setPicked (id: number, on: boolean) {
  stops.value = on ? [...stops.value, id] : stops.value.filter(x => x !== id)
}
</script>

<style scoped lang="scss">
// The map at most of the width, the list beside it; one above the other on
// narrow screens.
.cal-transfer-stops {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr);
  gap: 0.75rem 1.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;

  @media (max-width: 48rem) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cal-transfer-stops-list {
  min-width: 0;
  max-height: 17.5rem;
  overflow-y: auto;
}

.cal-transfer-stops-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.25rem;

  span {
    font-weight: 600;
    color: var(--bulma-text-strong);
  }
}

.cal-transfer-stops-nearby {
  margin-bottom: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  background: var(--bulma-scheme-main-ter);
  font-size: 0.8rem;

  .cal-transfer-stops-link {
    font-size: inherit;
  }
}

.cal-transfer-stops-nearby-operator {
  color: var(--bulma-text-weak);
}

.cal-transfer-stops-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 0.75rem;
  color: var(--bulma-link);
  cursor: pointer;
  text-decoration: underline;
}

.cal-transfer-stops-group {
  margin-bottom: 0.5rem;

  ul {
    margin: 0;
    list-style: none;
  }

  li :deep(label),
  li :deep(.checkbox) {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
}

li {
  padding: 0 0.25rem;
  border-radius: 4px;

  &:hover,
  &.cal-transfer-stops-hovered {
    background: color-mix(in srgb, #7a4dda 15%, transparent);
  }
}

.cal-transfer-stops-operator {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--bulma-text-weak);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0.25rem 0 0.1rem;
}

// The map's shapes: a circle for a stop, a square for a platform.
.cal-transfer-stops-shape-stop,
.cal-transfer-stops-shape-platform {
  flex: 0 0 auto;
  width: 0.6rem;
  height: 0.6rem;
  border: 2px solid #5b6470;
  background: #ffffff;
}

.cal-transfer-stops-shape-stop {
  border-radius: 50%;
}

.cal-transfer-stops-shape-platform {
  border-radius: 2px;
}

.cal-transfer-stops-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-transfer-stops-routes {
  flex: 0 1 auto;
  min-width: 2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
}

.cal-transfer-stops-empty {
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
}
</style>
