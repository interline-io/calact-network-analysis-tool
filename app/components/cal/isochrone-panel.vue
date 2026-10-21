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
      <!-- Toggle buttons bind ariaPressed and ariaLabel in an object: vue-tsc
           reads the hyphenated attributes lint asks for as native ones. -->
      <div class="cal-isochrone-row">
        <div role="group" aria-label="Direction">
          <cat-field addons class="cal-isochrone-group">
            <div v-for="d of directions" :key="d.label" class="control">
              <cat-button
                size="small"
                :variant="params.arriveBy === d.arriveBy ? 'primary' : undefined"
                v-bind="{ ariaPressed: params.arriveBy === d.arriveBy }"
                @click="update({ arriveBy: d.arriveBy })"
              >
                {{ d.label }}
              </cat-button>
            </div>
          </cat-field>
        </div>
        <!-- As the map draws the place. -->
        <span class="cal-isochrone-place" :title="`${placeLabel}. Drag the marker to move it.`">
          <i class="mdi" :class="params.arriveBy ? 'mdi-flag-checkered' : 'mdi-circle'" />
          {{ placeLabel }}
        </span>
      </div>

      <div class="cal-isochrone-row">
        <label class="cal-isochrone-field cal-isochrone-date">
          <span class="cal-isochrone-label">Date</span>
          <input
            class="input is-small"
            type="date"
            :value="params.date"
            required
            @change="onDate"
          >
        </label>
        <label class="cal-isochrone-field cal-isochrone-time">
          <span class="cal-isochrone-label">{{ params.arriveBy ? 'Arrive by' : 'Leave at' }}</span>
          <input
            class="input is-small"
            type="time"
            :value="params.time"
            required
            @change="onTime"
          >
        </label>
        <label class="cal-isochrone-field cal-isochrone-walk" title="Farthest walk to the first stop, or from the last">
          <span class="cal-isochrone-label">Max walk</span>
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

      <div class="cal-isochrone-field">
        <span class="cal-isochrone-label">Travel time (min)</span>
        <div role="group" aria-label="Travel time in minutes">
          <cat-field addons class="cal-isochrone-group">
            <div v-for="m of cutoffChoices" :key="m" class="control">
              <cat-button
                size="small"
                :variant="params.cutoffs.includes(m) ? 'primary' : undefined"
                v-bind="{ ariaPressed: params.cutoffs.includes(m), ariaLabel: `${m} minutes` }"
                :disabled="params.cutoffs.length === 1 && params.cutoffs.includes(m)"
                @click="toggleCutoff(m)"
              >
                {{ m }}
              </cat-button>
            </div>
          </cat-field>
        </div>
      </div>

      <div class="cal-isochrone-field">
        <span class="cal-isochrone-label">Ride</span>
        <div class="cal-isochrone-row">
          <div role="group" aria-label="Route types">
            <cat-field addons class="cal-isochrone-group">
              <div v-for="rt of ISOCHRONE_ROUTE_TYPES" :key="rt" class="control">
                <cat-button
                  size="small"
                  :icon-left="routeTypeIcons.get(rt)"
                  :variant="selectedRouteTypes.includes(rt) ? 'primary' : undefined"
                  v-bind="{ ariaPressed: selectedRouteTypes.includes(rt), ariaLabel: routeTypeNames.get(rt) }"
                  :title="routeTypeNames.get(rt)"
                  :disabled="params.mode.walkOnly || (selectedRouteTypes.length === 1 && selectedRouteTypes.includes(rt))"
                  @click="toggleRouteType(rt, !selectedRouteTypes.includes(rt))"
                />
              </div>
            </cat-field>
          </div>
          <cat-field addons class="cal-isochrone-group">
            <div class="control">
              <cat-button
                size="small"
                icon-left="walk"
                :variant="params.mode.walkOnly ? 'primary' : undefined"
                v-bind="{ ariaPressed: params.mode.walkOnly }"
                title="Walk only, without transit"
                @click="setWalkOnly(!params.mode.walkOnly)"
              >
                Walk only
              </cat-button>
            </div>
          </cat-field>
        </div>
      </div>

      <p v-if="error || empty || loading" class="cal-isochrone-status" aria-live="polite">
        <span v-if="error" class="cal-isochrone-error">Could not calculate travel times: {{ error }}</span>
        <span v-else-if="empty">Nothing reachable within these settings.</span>
        <span v-else><i class="mdi mdi-loading mdi-spin" /> Calculating…</span>
      </p>

      <div class="cal-isochrone-actions">
        <cat-button
          size="small"
          icon-left="magnify-expand"
          :disabled="!bands.length || empty"
          @click="$emit('zoom')"
        >
          Zoom to
        </cat-button>
        <cal-geojson-download
          button-text="Download GeoJSON"
          :disabled="!bands.length || empty"
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
import { routeTypeIcons, routeTypeNames, type Feature, type RouteType } from '~~/src/core'
import {
  ISOCHRONE_CUTOFF_CHOICES,
  ISOCHRONE_MAX_CUTOFFS,
  ISOCHRONE_MAX_WALK_CHOICES,
  ISOCHRONE_ROUTE_TYPES,
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

const directions = [
  { label: 'Leaving from', arriveBy: false },
  { label: 'Arriving at', arriveBy: true },
]

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

.cal-isochrone-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 6px 8px;
  margin-bottom: 6px;
}

// Bulma's field margin, inside a row that spaces its own items.
.cal-isochrone-group {
  margin-bottom: 0 !important;
}

.cal-isochrone-place {
  align-self: center;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;

  .mdi {
    color: #08306b;
  }
}

.cal-isochrone-field {
  display: block;
  margin-bottom: 6px;

  .cal-isochrone-row & {
    margin-bottom: 0;
  }
}

.cal-isochrone-date {
  flex: 1.3;
}

.cal-isochrone-time {
  flex: 1;
}

.cal-isochrone-walk {
  flex: 0.9;
}

.cal-isochrone-label {
  display: block;
  font-weight: 600;
  margin-bottom: 2px;
}

.cal-isochrone-status {
  margin: 4px 0 6px;
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
