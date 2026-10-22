<template>
  <div class="cal-sidebar-panel cal-isochrone-panel">
    <cat-msg
      :title="stopName ? `Travel time: ${stopName}` : 'Travel time'"
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
        <!-- Typed, pasted or copied; the icon is the map's marker. -->
        <cat-input
          class="cal-isochrone-place"
          size="small"
          :model-value="placeText"
          :model-modifiers="{ lazy: true, trim: true }"
          :icon="params.arriveBy ? 'flag-checkered' : 'circle'"
          icon-right="content-copy"
          icon-right-clickable
          icon-right-aria-label="Copy coordinates"
          :variant="placeInvalid ? 'danger' : undefined"
          v-bind="{ ariaLabel: 'Latitude, longitude' }"
          @update:model-value="onPlace"
          @icon-right-click="copyPlace"
        />
      </div>

      <div class="cal-isochrone-row">
        <label class="cal-isochrone-field cal-isochrone-date">
          <span class="cal-isochrone-label">Date</span>
          <cat-datepicker
            :key="dateKey"
            size="small"
            :model-value="parseDate(params.date)"
            @update:model-value="onDate"
          />
        </label>
        <label class="cal-isochrone-field cal-isochrone-time">
          <span class="cal-isochrone-label">{{ params.arriveBy ? 'Arrive by' : 'Leave at' }}</span>
          <cal-timepicker
            size="small"
            icon="clock"
            :model-value="parseTime(`${params.time}:00`)"
            @update:model-value="onTime"
          />
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
        <span class="cal-isochrone-label">Travel time</span>
        <div role="group" aria-label="Travel time">
          <cat-field addons class="cal-isochrone-group">
            <div v-for="m of cutoffChoices" :key="m" class="control is-expanded">
              <cat-button
                size="small"
                fullwidth
                :style="cutoffStyle(m)"
                v-bind="{ ariaPressed: params.cutoffs.includes(m), ariaLabel: `${m} minutes` }"
                :disabled="params.cutoffs.includes(m) ? params.cutoffs.length === 1 : cutoffsFull"
                @click="toggleCutoff(m)"
              >
                {{ cutoffLabel(m) }}
              </cat-button>
            </div>
            <div class="control">
              <cat-button
                size="small"
                icon-left="plus"
                v-bind="{ ariaLabel: 'Add a travel time', ariaExpanded: addingCutoff }"
                :title="cutoffsFull ? `At most ${ISOCHRONE_MAX_CUTOFFS} travel times` : 'Add a travel time'"
                :disabled="cutoffsFull"
                @click="startAddingCutoff"
              />
            </div>
          </cat-field>
        </div>
        <cat-input
          v-if="addingCutoff"
          ref="cutoffInput"
          class="cal-isochrone-add-cutoff"
          size="small"
          placeholder="Add a time: 90, 1h30m, 2h"
          :model-value="''"
          :model-modifiers="{ lazy: true, trim: true }"
          :variant="cutoffInvalid ? 'danger' : undefined"
          v-bind="{ ariaLabel: 'Travel time to add' }"
          @update:model-value="addCutoff"
        />
        <p v-if="cutoffInvalid" class="cal-isochrone-error">
          A time from 1 minute to 4 hours, such as 90, 1h30m or 2h.
        </p>
      </div>

      <div class="cal-isochrone-field">
        <span class="cal-isochrone-label">Ride</span>
        <div class="cal-isochrone-row">
          <!-- Transit (of the route types beside it) or walking alone. -->
          <div role="group" aria-label="Ride">
            <cat-field addons class="cal-isochrone-group">
              <div v-for="r of rides" :key="r.label" class="control">
                <cat-button
                  size="small"
                  :icon-left="r.icon"
                  :variant="params.mode.walkOnly === r.walkOnly ? 'primary' : undefined"
                  v-bind="{ ariaPressed: params.mode.walkOnly === r.walkOnly }"
                  @click="setWalkOnly(r.walkOnly)"
                >
                  {{ r.label }}
                </cat-button>
              </div>
            </cat-field>
          </div>
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
        </div>
      </div>

      <p v-if="error || empty || loading" class="cal-isochrone-status" aria-live="polite">
        <span v-if="error" class="cal-isochrone-error">Could not calculate travel times: {{ error }}</span>
        <span v-else-if="empty">Nothing reachable within these settings.</span>
        <span v-else class="has-text-grey">Calculating…</span>
      </p>

      <div class="cal-isochrone-actions">
        <cat-button
          variant="ghost"
          size="small"
          :disabled="!bands.length || empty"
          @click="$emit('zoom')"
        >
          Show on map
        </cat-button>
        <cal-geojson-download
          size="small"
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
import { computed, nextTick, ref, watch } from 'vue'
import { fmtDate, fmtTime, formatDuration, parseDate, parseTime, routeTypeIcons, routeTypeNames, type Feature, type Point, type RouteType } from '~~/src/core'
import {
  ISOCHRONE_CUTOFF_CHOICES,
  ISOCHRONE_MAX_CUTOFFS,
  ISOCHRONE_MAX_WALK_CHOICES,
  ISOCHRONE_ROUTE_TYPES,
  formatIsochronePlace,
  isochroneCutoffColors,
  isochroneModeParam,
  parseIsochroneCutoff,
  parseIsochronePlace,
  type IsochroneBand,
  type IsochroneMode,
  type IsochroneParams,
  type IsochroneRenderOptions,
} from '~~/src/tl'

const props = defineProps<{
  params: IsochroneParams
  // The stop it was opened from, while the place is still there.
  stopName?: string
  // What Transit returns to after Walk only: the scenario's route types.
  defaultMode: IsochroneMode
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
  // The place was typed in.
  'move': [place: Point]
  'update:render': [next: IsochroneRenderOptions]
  // Fit the map to the bands.
  'zoom': []
}>()

const { unitSystem } = useScenarioDisplay()
const debug = useDebugMenu()

// As the URL holds it, so a copy pastes into either.
const placeText = computed(() => formatIsochronePlace(props.params.place))

// Typed coordinates that don't parse stay in the box, flagged, until fixed.
const placeInvalid = ref(false)
// By value: params are rebuilt on any URL change, the place with them.
watch(placeText, () => {
  placeInvalid.value = false
})

function onPlace (text: string | number) {
  const place = parseIsochronePlace(String(text).replace(/\s+/g, ''))
  placeInvalid.value = !place
  if (place) {
    emit('move', place)
  }
}

async function copyPlace () {
  try {
    await navigator.clipboard.writeText(placeText.value)
    useToastNotification().showToast('Copied to clipboard')
  } catch (err) {
    console.warn('clipboard write failed', err)
  }
}

const directions = [
  { label: 'Leaving from', arriveBy: false },
  { label: 'Arriving at', arriveBy: true },
]

function update (next: Partial<IsochroneParams>) {
  emit('update', next)
}

// A cleared date has nothing to send, so the picker shows the one in use
// again.
const dateKey = ref(0)
function onDate (d: Date | null | undefined) {
  if (d) {
    update({ date: fmtDate(d) })
  } else {
    dateKey.value++
  }
}

// Undefined while a time is half typed: wait for the rest.
function onTime (d: Date | undefined) {
  if (d) {
    update({ time: fmtTime(d, 'HH:mm') })
  }
}

// Offered cutoffs, plus any a link asked for that aren't among them.
const cutoffChoices = computed(() => [...new Set([...ISOCHRONE_CUTOFF_CHOICES, ...props.params.cutoffs])].sort((a, b) => a - b))

// As many as the router takes: none more can be chosen.
const cutoffsFull = computed(() => props.params.cutoffs.length >= ISOCHRONE_MAX_CUTOFFS)

// Filled while typing one in: there's no room for it.
watch(cutoffsFull, (full) => {
  if (full) {
    addingCutoff.value = false
    cutoffInvalid.value = false
  }
})

// Compact, to fit the row: "1h30m".
function cutoffLabel (m: number): string {
  return formatDuration(m * 60).replace(' ', '')
}

// Typing a travel time in; it joins the row, chosen, and leaves it once
// unchosen, as presets don't.
const addingCutoff = ref(false)
const cutoffInvalid = ref(false)
const cutoffInput = ref<{ focus: () => void } | null>(null)

async function startAddingCutoff () {
  addingCutoff.value = !addingCutoff.value
  cutoffInvalid.value = false
  await nextTick()
  cutoffInput.value?.focus()
}

function addCutoff (text: string | number) {
  if (String(text) === '') {
    addingCutoff.value = false
    cutoffInvalid.value = false
    return
  }
  const m = parseIsochroneCutoff(String(text))
  cutoffInvalid.value = m === undefined
  if (m === undefined) {
    return
  }
  addingCutoff.value = false
  if (!props.params.cutoffs.includes(m)) {
    toggleCutoff(m)
  }
}

// Never drops one travel time to make room for another: at the limit, a
// new one isn't added.
function toggleCutoff (m: number) {
  const chosen = props.params.cutoffs.includes(m)
  if (chosen ? props.params.cutoffs.length === 1 : cutoffsFull.value) {
    return
  }
  update({ cutoffs: chosen ? props.params.cutoffs.filter(c => c !== m) : [...props.params.cutoffs, m].sort((a, b) => a - b) })
}

// Unlimited transit is every type the panel offers.
const selectedRouteTypes = computed((): RouteType[] => {
  const mode = props.params.mode
  return mode.walkOnly ? [] : (mode.routeTypes ?? ISOCHRONE_ROUTE_TYPES)
})

function toggleRouteType (rt: RouteType, on: boolean) {
  const current = selectedRouteTypes.value
  update({ mode: { walkOnly: false, routeTypes: on ? [...current, rt] : current.filter(t => t !== rt) } })
}

const rides = [
  { label: 'Transit', icon: 'bus-multiple', walkOnly: false },
  { label: 'Walk only', icon: 'walk', walkOnly: true },
]

// Transit returns to what the scenario rides, or all of it if the scenario
// rides nothing.
function setWalkOnly (walkOnly: boolean) {
  if (walkOnly === props.params.mode.walkOnly) {
    return
  }
  if (walkOnly) {
    update({ mode: { walkOnly: true } })
  } else {
    update({ mode: props.defaultMode.walkOnly ? { walkOnly: false } : props.defaultMode })
  }
}

// A chosen travel time wears its band's color, so the row keys the map.
function cutoffStyle (m: number): Record<string, string> | undefined {
  if (!props.params.cutoffs.includes(m)) {
    return undefined
  }
  const { fill, text } = isochroneCutoffColors(m, props.params.cutoffs)
  return { background: fill, borderColor: fill, color: text }
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
      name: props.stopName ?? placeText.value,
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
  flex: 1;
  min-width: 0;
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

.cal-isochrone-add-cutoff {
  margin-top: 4px;
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
}

.cal-isochrone-debug {
  margin-top: 8px;

  summary {
    cursor: pointer;
    margin-bottom: 4px;
  }
}
</style>
