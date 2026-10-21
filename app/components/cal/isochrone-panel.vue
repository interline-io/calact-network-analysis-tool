<template>
  <div class="cal-sidebar-panel cal-isochrone-panel">
    <cat-msg
      :title="`Travel time: ${placeLabel}`"
      expandable
      closable
      :open="true"
      variant="dark"
      @close="$emit('close')"
    >
      <div class="buttons has-addons cal-isochrone-direction" role="group" aria-label="Direction">
        <button
          type="button"
          class="button is-small"
          :class="{ 'is-link is-selected': !params.arriveBy }"
          :aria-pressed="!params.arriveBy"
          @click="update({ arriveBy: false })"
        >
          Leaving from
        </button>
        <button
          type="button"
          class="button is-small"
          :class="{ 'is-link is-selected': params.arriveBy }"
          :aria-pressed="params.arriveBy"
          @click="update({ arriveBy: true })"
        >
          Arriving at
        </button>
      </div>

      <p class="cal-isochrone-place">
        <i class="mdi mdi-map-marker" />
        {{ placeLabel }}
        <span class="cal-isochrone-hint">Drag the marker to move it.</span>
      </p>

      <div class="cal-isochrone-when">
        <label class="cal-isochrone-field">
          <span class="cal-isochrone-label">Date</span>
          <input
            class="input is-small"
            type="date"
            :value="params.date"
            required
            @change="onDate"
          >
        </label>
        <label class="cal-isochrone-field">
          <span class="cal-isochrone-label">{{ params.arriveBy ? 'Arrive by' : 'Leave at' }}</span>
          <input
            class="input is-small"
            type="time"
            :value="params.time"
            required
            @change="onTime"
          >
        </label>
      </div>

      <div class="cal-isochrone-section">
        <span class="cal-isochrone-label">Travel time</span>
        <div class="buttons are-small cal-isochrone-cutoffs">
          <button
            v-for="m of cutoffChoices"
            :key="m"
            type="button"
            class="button"
            :class="{ 'is-link is-selected': params.cutoffs.includes(m) }"
            :aria-pressed="params.cutoffs.includes(m)"
            :disabled="params.cutoffs.length === 1 && params.cutoffs.includes(m)"
            @click="toggleCutoff(m)"
          >
            {{ m }} min
          </button>
        </div>
      </div>

      <div class="cal-isochrone-section">
        <span class="cal-isochrone-label">Ride</span>
        <div class="cal-isochrone-modes">
          <cat-checkbox
            v-for="rt of ISOCHRONE_ROUTE_TYPES"
            :key="rt"
            size="small"
            :label="routeTypeNames.get(rt)"
            :model-value="!params.mode.walkOnly && selectedRouteTypes.includes(rt)"
            :disabled="params.mode.walkOnly || (selectedRouteTypes.length === 1 && selectedRouteTypes.includes(rt))"
            @update:model-value="toggleRouteType(rt, $event)"
          />
          <cat-checkbox
            size="small"
            label="Walk only"
            :model-value="params.mode.walkOnly"
            @update:model-value="setWalkOnly"
          />
        </div>
      </div>

      <div class="cal-isochrone-section">
        <label class="cal-isochrone-field">
          <span class="cal-isochrone-label">Max walk to or from a stop</span>
          <cat-select
            size="small"
            :model-value="String(params.maxWalk)"
            @update:model-value="update({ maxWalk: Number($event) })"
          >
            <option v-for="m of maxWalkChoices" :key="m" :value="String(m)">
              {{ formatDistance(m) }}
            </option>
          </cat-select>
        </label>
      </div>

      <p class="cal-isochrone-caveat">
        <template v-if="params.arriveBy">
          Reach for a single arrival by {{ params.time }}. Arriving a few minutes earlier or later can change the result.
        </template>
        <template v-else>
          Reach for a single departure at {{ params.time }}. Leaving a few minutes earlier or later can change the result.
        </template>
      </p>

      <div class="cal-isochrone-result" aria-live="polite">
        <p v-if="error" class="cal-isochrone-error">
          Could not calculate travel times: {{ error }}
        </p>
        <p v-else-if="empty" class="cal-isochrone-empty">
          Nothing reachable within these settings.
        </p>
        <ul v-else-if="legend.length" class="cal-isochrone-legend" :class="{ 'is-stale': loading }">
          <li v-for="row of legend" :key="row.label">
            <span class="cal-isochrone-swatch" :style="{ background: row.color }" />
            {{ row.label }}
          </li>
        </ul>
        <p v-if="loading" class="cal-isochrone-loading">
          <i class="mdi mdi-loading mdi-spin" /> Calculating…
        </p>
      </div>

      <div class="cal-isochrone-actions">
        <cat-button
          size="small"
          icon-left="magnify-expand"
          :disabled="!legend.length || empty"
          @click="$emit('zoom')"
        >
          Zoom to
        </cat-button>
        <cal-geojson-download
          button-text="Download GeoJSON"
          :disabled="!legend.length || empty"
          :filename="downloadFilename"
          :data="downloadFeatures"
        />
      </div>

      <!-- Contouring knobs, for tuning against the router; blank is the
           router's default. -->
      <details v-if="debug" class="cal-isochrone-debug">
        <summary>Rendering (debug)</summary>
        <label class="cal-isochrone-field">
          <span class="cal-isochrone-label">expansion</span>
          <cat-select
            size="small"
            :model-value="render.expansion ?? ''"
            @update:model-value="setRender('expansion', $event || undefined)"
          >
            <option value="">
              (default)
            </option>
            <option value="network">
              network
            </option>
            <option value="disk">
              disk
            </option>
          </cat-select>
        </label>
        <label v-for="k of numericRenderKeys" :key="k" class="cal-isochrone-field">
          <span class="cal-isochrone-label">{{ k }}</span>
          <input
            class="input is-small"
            type="number"
            :value="render[k] ?? ''"
            @change="setRender(k, numberOrUndefined(($event.target as HTMLInputElement).value))"
          >
        </label>
      </details>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { routeTypeNames, type Feature, type RouteType } from '~~/src/core'
import {
  ISOCHRONE_CUTOFF_CHOICES,
  ISOCHRONE_MAX_CUTOFFS,
  ISOCHRONE_MAX_WALK_CHOICES,
  ISOCHRONE_ROUTE_TYPES,
  isochroneLegend,
  isochroneModeParam,
  type IsochroneBand,
  type IsochroneParams,
  type IsochroneRenderOptions,
} from '~~/src/tl'

const props = defineProps<{
  params: IsochroneParams
  // The place by name: its stop's, or its coordinates.
  placeLabel: string
  // Shortest time first.
  bands: IsochroneBand[]
  loading: boolean
  error: string | null
  empty: boolean
  // Contouring knobs, shown with the debug menu on.
  render: IsochroneRenderOptions
}>()

const emit = defineEmits<{
  'close': []
  'update': [next: Partial<IsochroneParams>]
  'update:render': [next: IsochroneRenderOptions]
  // Fit the map to the bands.
  'zoom': []
}>()

const { unitSystem } = useScenarioDisplay()
const debug = useDebugMenu()

function update (next: Partial<IsochroneParams>) {
  emit('update', next)
}

function onDate (e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v) {
    update({ date: v })
  }
}

function onTime (e: Event) {
  const v = (e.target as HTMLInputElement).value.slice(0, 5)
  if (v) {
    update({ time: v })
  }
}

// Offered cutoffs, plus any a link asked for that aren't among them.
const cutoffChoices = computed(() => [...new Set([...ISOCHRONE_CUTOFF_CHOICES, ...props.params.cutoffs])].sort((a, b) => a - b))

function toggleCutoff (m: number) {
  const cutoffs = props.params.cutoffs.includes(m)
    ? props.params.cutoffs.filter(c => c !== m)
    : [...props.params.cutoffs, m].sort((a, b) => a - b).slice(0, ISOCHRONE_MAX_CUTOFFS)
  if (cutoffs.length > 0) {
    update({ cutoffs })
  }
}

// Unlimited transit is every type the panel offers.
const selectedRouteTypes = computed((): RouteType[] => {
  const mode = props.params.mode
  return mode.walkOnly ? [] : (mode.routeTypes ?? ISOCHRONE_ROUTE_TYPES)
})

function toggleRouteType (rt: RouteType, on: boolean) {
  const current = selectedRouteTypes.value
  const next = on ? [...current, rt] : current.filter(t => t !== rt)
  const mode = { walkOnly: false as const, routeTypes: next }
  // Every type is all of transit, so a link reads the same either way.
  update({ mode: isochroneModeParam(mode) === 'TRANSIT' ? { walkOnly: false } : mode })
}

function setWalkOnly (walkOnly: boolean) {
  update({ mode: walkOnly ? { walkOnly: true } : { walkOnly: false } })
}

const maxWalkChoices = computed(() => [...new Set([...ISOCHRONE_MAX_WALK_CHOICES, props.params.maxWalk])].sort((a, b) => a - b))

function formatDistance (m: number): string {
  if (unitSystem.value === 'us') {
    return `${(m / 1609.344).toLocaleString(undefined, { maximumFractionDigits: 2 })} mi`
  }
  return m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${m} m`
}

const legend = computed(() => isochroneLegend(props.bands))

// The bands, and the place with what they were asked for, so a download
// says what it shows.
const downloadFeatures = computed((): Feature[] => [
  ...props.bands.map(b => b.feature),
  {
    type: 'Feature',
    id: 'isochrone-place',
    geometry: { type: 'Point', coordinates: [props.params.place.lon, props.params.place.lat] },
    properties: {
      name: props.placeLabel,
      arrive_by: props.params.arriveBy,
      date: props.params.date,
      time: props.params.time,
      mode: isochroneModeParam(props.params.mode),
      max_walk_meters: props.params.maxWalk,
    },
  },
])

const downloadFilename = computed(() => `travel-time-${props.params.date}-${props.params.time.replace(':', '')}`)

const numericRenderKeys = ['buffer', 'cellSize', 'generalize', 'denoise', 'smooth'] as const

function numberOrUndefined (v: string): number | undefined {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) ? n : undefined
}

function setRender<K extends keyof IsochroneRenderOptions> (k: K, v: IsochroneRenderOptions[K] | string | undefined) {
  emit('update:render', { ...props.render, [k]: v })
}
</script>

<style scoped lang="scss">
.cal-isochrone-panel {
  font-size: 12px;
}

.cal-isochrone-direction {
  margin-bottom: 6px !important;
}

.cal-isochrone-place {
  margin-bottom: 8px;
  font-weight: 600;
}

.cal-isochrone-hint {
  display: block;
  font-weight: normal;
  color: var(--bulma-text-weak);
}

.cal-isochrone-when {
  display: flex;
  gap: 8px;

  .cal-isochrone-field {
    flex: 1;
  }
}

.cal-isochrone-field {
  display: block;
  margin-bottom: 6px;
}

.cal-isochrone-label {
  display: block;
  font-weight: 600;
  margin-bottom: 2px;
}

.cal-isochrone-section {
  margin-bottom: 6px;
}

.cal-isochrone-cutoffs {
  margin-bottom: 0 !important;

  .button {
    margin-bottom: 4px;
  }
}

.cal-isochrone-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.cal-isochrone-caveat {
  margin: 6px 0;
  color: var(--bulma-text-weak);
}

.cal-isochrone-result {
  margin: 6px 0;
}

.cal-isochrone-legend {
  list-style: none;
  margin: 0;

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  &.is-stale {
    opacity: 0.5;
  }
}

.cal-isochrone-swatch {
  display: inline-block;
  width: 16px;
  height: 12px;
  border-radius: 2px;
  opacity: 0.8;
}

.cal-isochrone-error {
  color: var(--bulma-danger);
}

.cal-isochrone-actions {
  display: flex;
  gap: 6px;

  :deep(.button) {
    font-size: 12px;
  }
}

.cal-isochrone-debug {
  margin-top: 8px;

  summary {
    cursor: pointer;
    margin-bottom: 4px;
  }
}
</style>
