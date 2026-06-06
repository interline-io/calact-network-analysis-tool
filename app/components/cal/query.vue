<template>
  <div class="cal-query">
    <cal-title title="Home">
      Transit Network Explorer
    </cal-title>

    <cat-msg v-if="props.scenarioLoaded" variant="warning">
      <p>A browse query is currently loaded.</p>
      <cat-button variant="warning" class="mt-3" @click="emit('resetScenario')">
        Reset and start a new query
      </cat-button>
    </cat-msg>
    <cat-msg v-else variant="info">
      <p>Start by specifying your desired date range and geographic bounds. To explore stops, routes, and frequencies on the map and in tabular view click <em>Run Browse Query</em>. Or for more specialized analysis, click <em>Run Advanced Analysis</em>.</p>
    </cat-msg>

    <div class="cal-body" :class="{ 'is-locked': props.scenarioLoaded }">
      <cat-msg title="Date range">
        <cat-field>
          <template #label>
            <cat-tooltip text="The start date is used to define which week is used to calculate the days-of-week on which a route runs or a stop is served. By default, the start date is the next Monday.">
              Start date
              <cat-icon size="small" icon="information" />
            </cat-tooltip>
          </template>
          <cat-datepicker
            v-model="startDate"
            :min-date="pickerMinDate"
            :max-date="pickerMaxDate"
            :years-range="datePickerYearsRange"
            :variant="isStartDateInRange ? undefined : 'danger'"
            readonly
          />
        </cat-field>
        <cat-field>
          <template #label>
            <cat-tooltip text="By default, the end date is one week after the start date.">
              End date
              <cat-icon size="small" icon="information" />
            </cat-tooltip>
          </template>
          <div v-if="!selectSingleDay" class="cal-query-end-date">
            <cat-datepicker
              ref="endDateRef"
              v-model="endDate"
              :min-date="pickerMinDate"
              :max-date="pickerMaxDate"
              :years-range="datePickerYearsRange"
              :variant="isEndDateInRange && isEndDateValid ? undefined : 'danger'"
              readonly
            />
            <!-- TODO: catenary >0.3.0 declares aria-label/title as cat-button
                 props; on the next bump, replace this v-bind workaround with
                 plain attributes. -->
            <cat-button
              icon="close"
              v-bind="{ 'aria-label': 'Remove end date', 'title': 'Remove end date (query a single day)' }"
              @click="toggleSelectSingleDay()"
            />
          </div>
          <cat-button v-else ref="setEndDateRef" @click="toggleSelectSingleDay()">
            Set an end date
          </cat-button>
          <p v-if="!isEndDateValid" class="help is-danger">
            End date must be on or after the start date.
          </p>
        </cat-field>
        <p v-if="!isStartDateInRange || !isEndDateInRange" class="help is-danger">
          Dates must be within the last {{ WIDE_DATE_YEARS_BACK }} years or next {{ WIDE_DATE_YEARS_FORWARD }} years.
        </p>
        <p v-else-if="datesOutsidePickerRange" class="help">
          Dates are outside the default range (last 90 days to next year) —
          results depend on feed versions imported from the Feed Archive.
        </p>

        <div class="cal-query-archive">
          <p class="help">
            Querying past dates? Pin exact feed versions from the Feed Archive.
          </p>
          <div class="cal-query-archive-actions">
            <cat-button variant="ghost" class="cal-query-archive-link" @click="showFvPicker = true">
              Open Feed Archive…
              <span v-if="fvOverrideCount > 0" class="cal-query-fv-badge">{{ fvOverrideCount }}</span>
            </cat-button>
            <cat-button
              v-if="fvOverrideCount > 0"
              variant="ghost"
              class="cal-query-archive-link"
              @click="fvids = ''"
            >
              Clear overrides
            </cat-button>
          </div>
          <cal-feed-version-override-summary
            v-if="fvOverrideCount > 0"
            :fvids="fvids"
            class="mt-2"
          />
        </div>
      </cat-msg>

      <cat-msg title="Geographic Bounds">
        <div class="columns is-align-items-flex-end">
          <div class="column is-half">
            <cat-field>
              <template #label>
                <cat-tooltip text="Specify the area of interest for your query. The area is used to query for transit stops, as well as the routes that serve those stops. Note that routes that traverse the area without any designated stops will not be identified.">
                  Select geography by
                  <cat-icon icon="information" />
                </cat-tooltip>
              </template>
              <cat-select v-model="geomSource">
                <option
                  v-for="[key, label] of Object.entries(geomSources)"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </cat-select>
            </cat-field>
          </div>

          <div class="column is-half" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
            <cat-field>
              <template #label>
                Boundary type
              </template>
              <cat-select v-model="geomLayer">
                <option
                  v-for="option of props.censusGeographyLayerOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </cat-select>
            </cat-field>
          </div>
        </div>

        <div class="container is-max-tablet" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
          <p v-if="props.viewportGeographiesLoading" class="help mb-2">
            <cat-icon icon="loading" size="small" />
            Loading boundaries...
          </p>
          <p v-else-if="(props.viewportGeographies?.length ?? 0) > 0" class="help mb-2">
            {{ props.viewportGeographies?.length }} boundaries visible on map<span v-if="geographyIds.length > 0">, {{ geographyIds.length }} selected</span>. Click to select.
          </p>
          <p v-if="!props.viewportGeographiesLoading && (props.viewportGeographies?.length ?? 0) >= (props.viewportGeographiesLimit ?? 1000)" class="help has-text-warning-dark mb-2">
            Results limited to {{ props.viewportGeographiesLimit ?? 1000 }} boundaries. Zoom in to see all boundaries in the viewport.
          </p>

          <cat-field>
            <template #label>
              Selected administrative boundaries
              <span v-if="geographyIds.length > 0" class="ml-2">
                <a role="button" class="is-size-7" @click="emit('fitToGeographies')">Show on map</a>
                <span class="mx-1">|</span>
                <a role="button" class="is-size-7" @click="emit('clearGeographies')">Clear all</a>
              </span>
            </template>
            <cat-taginput
              v-model="geographyIds"
              v-model:input="geomSearch"
              :open-on-focus="true"
              :options="selectedGeographyTagOptions"
              icon="magnify"
              placeholder="Search..."
              fullwidth
              :loading="geomResultLoading"
            >
              <template #header>
                <strong>
                  <span v-if="geomSearch.length < 2">Type to search...</span>
                  <span v-else-if="geomResultLoading">Loading...</span>
                  <span v-else-if="selectedGeographyTagOptions.length === 0">No results found</span>
                  <span v-else>{{ selectedGeographyTagOptions.length }} results found</span>
                </strong>
              </template>
              <template #option="{ option }">
                <div class="is-flex is-align-items-center">
                  <span>{{ option.label }}</span>
                  <span class="tag is-light is-small ml-2">
                    {{ option.geographyType }}
                  </span>
                </div>
              </template>
            </cat-taginput>
          </cat-field>

          <cat-msg
            v-if="geographyIds.length > 1"
            variant="warning"
            class="mt-3"
          >
            Multiple administrative boundaries are selected, but census
            intersection values currently use <strong>only the first
              boundary</strong>. Support for multi-boundary census queries
            is pending a backend update (#347).
          </cat-msg>
        </div>
      </cat-msg>

      <cat-msg
        title="Advanced Settings"
        variant="dark"
        expandable
      >
        <div class="container is-max-tablet">
          <!-- Data to Load Section -->
          <cat-field label="Data to Load">
            <div class="is-flex">
              <cat-checkbox
                v-model="includeFixedRoute"
                class="mr-5"
              >
                Include Fixed-Route Transit
              </cat-checkbox>
              <cat-checkbox
                v-model="includeFlexAreas"
              >
                Include Flex Service Areas
              </cat-checkbox>
            </div>
          </cat-field>

          <!-- Census Geography Dataset -->
          <cal-census-dataset-picker
            v-model="geoDatasetName"
            label="Census geography dataset"
            tooltip="Select which version of TIGER census boundaries to use for admin boundary selection and geographic aggregation."
            name-filter="tiger"
          />

          <!-- Aggregation Section -->
          <cat-field>
            <template #label>
              <cat-tooltip text="Group data within the Report tab by geographic boundaries (cities, counties, etc.). This creates a summary table showing aggregated statistics for each geographic area. Currently only available when 'Stop' is selected as the data view.">
                Aggregate by Census geographic hierarchy level
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-select v-model="aggregateLayer">
              <option
                v-for="option of censusGeographyLayerOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </cat-select>
          </cat-field>
        </div>
      </cat-msg>

      <cat-msg v-if="debugMenu" title="Debug menu" variant="warning">
        <cat-field label="Preset bounding box">
          <div class="is-flex is-align-items-center" style="gap: 0.5rem;">
            <cat-select v-model="cannedBbox">
              <option v-for="[cannedBboxName, cannedBboxDetails] of Object.entries(cannedBboxes)" :key="cannedBboxName" :value="cannedBboxName">
                {{ cannedBboxDetails.label }}
              </option>
            </cat-select>
            <cat-button @click="loadExampleData">
              Load example
            </cat-button>
          </div>
        </cat-field>
      </cat-msg>

      <div class="field has-addons cal-query-actions">
        <cat-button variant="primary" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('explore')">
          Run Browse Query
        </cat-button>
        <cat-button variant="primary" outlined :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('switchToAnalysisTab')">
          Run Advanced Analysis
        </cat-button>
      </div>
    </div>

    <cal-feed-version-picker-modal
      v-model:open="showFvPicker"
      :start-date="startDate"
      :end-date="endDate"
      :fvids="fvids"
      :bbox="bbox"
      @apply="onModalApply"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue'
import { useToggle } from '@vueuse/core'
import { useLazyQuery } from '@vue/apollo-composable'
import type { Point } from '~~/src/core'
import {
  asDateString,
  cannedBboxes,
  geomSources,
  normalizeDate,
  PANEL_PADDING,
  QUERY_PANEL_WIDTH,
  validEndDate,
  WIDE_DATE_YEARS_BACK,
  WIDE_DATE_YEARS_FORWARD,
  wideMaxAllowedDate,
  wideMinAllowedDate,
} from '~~/src/core'
import { type CensusDataset, type CensusGeography, geographySearchQuery, parseFvids } from '~~/src/tl'
import CalFeedVersionPickerModal from '~/components/cal/feed-version-picker-modal.vue'
import CalFeedVersionOverrideSummary from '~/components/cal/feed-version-override-summary.vue'

const emit = defineEmits([
  'fitToGeographies',
  'clearGeographies',
  'explore',
  'loadExampleData',
  'switchToAnalysisTab',
  'resetScenario'
])

const loadExampleData = async () => {
  emit('loadExampleData', cannedBbox.value)
}

const props = defineProps<{
  censusGeographyLayerOptions: { label: string, value: string }[]
  viewportGeographies?: CensusGeography[]
  viewportGeographiesLoading?: boolean
  viewportGeographiesLimit?: number
  mapExtentCenter?: Point
  censusGeographiesSelected?: CensusGeography[]
  scenarioLoaded?: boolean
}>()

const panelWidthPx = `${QUERY_PANEL_WIDTH}px`
const panelPaddingPx = `${PANEL_PADDING}px`

const {
  bbox,
  cannedBbox,
  startDate,
  endDate,
  geographyIds,
  geomSource,
  geomLayer,
  geoDatasetName,
  includeFixedRoute,
  includeFlexAreas,
  fvids,
  applyDatesAndFvids,
} = useScenarioInputs()

const showFvPicker = ref(false)
const fvOverrideCount = computed(() => {
  const parsed = parseFvids(fvids.value)
  return parsed.picks.size + parsed.excluded.size
})
const { aggregateLayer } = useScenarioDisplay()
const debugMenu = useDebugMenu()
const geomSearch = ref('')
const selectSingleDay = ref(true)
const toggleSelectSingleDay = useToggle(selectSingleDay)

// The inline pickers steer users to recent dates, where active feed versions
// have coverage. Validation accepts the much wider window the "Dates & feed
// versions" modal can set (#223) — picking/importing historical feed versions
// is what makes older dates meaningful.
const today = new Date()
const pickerMinDate = new Date(today)
pickerMinDate.setDate(today.getDate() - 90)
const pickerMaxDate = new Date(today)
pickerMaxDate.setFullYear(today.getFullYear() + 1)
const validMinDate = wideMinAllowedDate()
const validMaxDate = wideMaxAllowedDate()
// yearsRange is relative offsets [before, after] from current year for the year dropdown
const datePickerYearsRange: [number, number] = [-1, 1]

function isDateInRange (d: Date | undefined): boolean {
  const date = normalizeDate(d)
  if (!date) {
    return true
  }
  return date >= validMinDate && date <= validMaxDate
}

function isDateInPickerRange (d: Date | undefined): boolean {
  const date = normalizeDate(d)
  if (!date) {
    return true
  }
  return date >= pickerMinDate && date <= pickerMaxDate
}

const isStartDateInRange = computed(() => isDateInRange(startDate.value))
const isEndDateInRange = computed(() => isDateInRange(endDate.value))

// Informational only — flags a (valid) window beyond what the inline pickers
// offer, i.e. one set via the "Dates & feed versions" modal.
const datesOutsidePickerRange = computed(() =>
  !isDateInPickerRange(startDate.value) || !isDateInPickerRange(endDate.value))

const isEndDateValid = computed(() => validEndDate(startDate.value, endDate.value, selectSingleDay.value))

const geomSearchVars = computed(() => {
  return {
    dataset_name: geoDatasetName.value,
    layer: geomLayer.value,
    search: geomSearch.value,
    limit: 10,
    focus: props.mapExtentCenter,
  }
})

const {
  result: geomResult,
  loading: geomResultLoading,
  load: geomLoad,
  refetch: geomRefetch,
} = useLazyQuery<{ census_datasets: CensusDataset[] }>(
  geographySearchQuery,
  geomSearchVars,
  {
    debounce: 50,
    keepPreviousResult: true
  }
)

const endDateRef = ref<{ focus: () => void } | null>(null)
const setEndDateRef = ref<ComponentPublicInstance | null>(null)

// When toggling single-day mode, sync endDate to the URL query params.
// In single-day mode, endDate matches startDate. When switching to range mode,
// we create a copy so Vue detects a change and persists the value to the URL.
// When the end-date picker appears, move focus into it for keyboard users (#361).
// Suppressed during a modal Apply — the modal commits its own (already
// consistent) dates in a single batched URL write.
let suppressSingleDayWatch = false
watch(selectSingleDay, async (newVal) => {
  if (suppressSingleDayWatch) {
    return
  }
  if (newVal) {
    endDate.value = startDate.value
    // The icon button that was clicked unmounts with the picker; move focus
    // to the "Set an end date" button so keyboard focus isn't dropped.
    await nextTick()
    const el = setEndDateRef.value?.$el as HTMLElement | undefined
    el?.focus?.()
  } else {
    endDate.value = new Date(endDate.value)
    await nextTick()
    endDateRef.value?.focus()
  }
})

// In single-day mode the end-date picker is hidden, so a start-date change
// must carry endDate along — otherwise the URL keeps a stale endDate that no
// longer matches the selected single day.
watch(startDate, (v) => {
  if (selectSingleDay.value && asDateString(endDate.value) !== asDateString(v)) {
    endDate.value = v
  }
})

// The "Dates & feed versions" modal stages dates + fvids and commits them
// here atomically — one setQuery navigation so the params can't race.
function onModalApply (payload: { startDate: Date, endDate: Date, fvids: string, singleDay: boolean }) {
  if (selectSingleDay.value !== payload.singleDay) {
    suppressSingleDayWatch = true
    selectSingleDay.value = payload.singleDay
    void nextTick(() => { suppressSingleDayWatch = false })
  }
  applyDatesAndFvids({
    startDate: payload.startDate,
    endDate: payload.endDate,
    fvids: payload.fvids,
  })
}

watch(geomSearchVars, () => {
  if ((geomSearch.value || '').length >= 2 && geomLayer.value) {
    if (geomSearch.value && geomLayer.value) {
      geomLoad(geographySearchQuery)
    } else {
      geomRefetch()
    }
  }
})

// Focus search input when Administrative Boundary is selected
watch(geomSource, (newValue, oldValue) => {
  if (newValue === 'adminBoundary') {
    nextTick(() => {
      const searchInput = document.querySelector('.taginput input[type="text"]') as HTMLInputElement
      if (searchInput) {
        searchInput.focus()
      }
    })
  } else if (oldValue === 'adminBoundary' && newValue !== 'adminBoundary') {
    // Clear selected geographies when switching away from Administrative Boundary.
    // censusGeographiesSelected upstream is computed from geographyIds so it
    // updates automatically once we clear the IDs.
    geographyIds.value = []
    geomSearch.value = ''
    geomResult.value = undefined
  }
})

const selectedGeographyTagOptions = computed((): { value: number, label: string }[] => {
  // Combine selected geographies, viewport geographies, and search results
  const geogs: CensusGeography[] = []
  for (const geo of props.censusGeographiesSelected || []) {
    geogs.push({
      ...geo,
    })
  }
  for (const geo of props.viewportGeographies || []) {
    geogs.push({
      ...geo,
    })
  }
  for (const geo of geomResult.value?.census_datasets || []) {
    for (const g of geo.geographies || []) {
      geogs.push({
        ...g,
      })
    }
  }

  // "options" must include the already selected geographies, otherwise the label will not work
  const options = new Map<number, CensusGeography>()

  // Add the search query results
  for (const geo of geogs || []) {
    if (options.has(geo.id)) {
      continue // already selected
    }
    options.set(geo.id, geo)
  }

  // Convert `options` into Array with `value` and `label` props
  const results = []
  for (const geo of options.values()) {
    // for now, generate a id to put after the name
    const stateDesc = geo.adm1_name ? `, ${geo.adm1_name}` : ''
    const label = `${geo.name}${stateDesc} (${geo.layer.description || geo.layer.name})`
    results.push({ value: geo.id, label })
  }
  return results
})

const validQueryParams = computed(() => {
  const hasValidDate = startDate.value
  const hasValidBounds = bbox?.value?.valid

  // Start and end dates must be within the allowed range
  if (!isStartDateInRange.value || !isEndDateInRange.value) {
    return false
  }

  // End date must be valid (on or after start date)
  if (!isEndDateValid.value) {
    return false
  }

  // If using administrative boundaries, must have at least one geography selected
  if (geomSource.value === 'adminBoundary') {
    return hasValidDate && (geographyIds.value?.length ?? 0) > 0
  }

  // For other modes (bbox, map extent), use existing validation
  return hasValidDate && hasValidBounds
})
</script>

<style scoped lang="scss">
  .cal-query {
    max-width: v-bind(panelWidthPx);
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    padding-left: v-bind(panelPaddingPx);
    padding-right: v-bind(panelPaddingPx);
    > .cal-body {
      > div, > article {
        margin-bottom:10px;
      }
    }
  }

  .cal-body.is-locked {
    opacity: 0.45;
    pointer-events: none;
    user-select: none;
  }

  .cal-query-actions {
    width: 100%;
    :deep(.control) {
      flex-grow: 1;
    }
  }

  .cal-query-end-date {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cal-query-archive {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--bulma-border-weak, #ededed);
  }

  .cal-query-archive-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  // Ghost buttons carry default button padding; trim so the link text
  // aligns with the help copy above it.
  .cal-query-archive-link :deep(.button) {
    padding-left: 0;
    padding-right: 0;
    height: auto;
  }
  .cal-query-fv-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    margin-left: 6px;
    background: #1d6fb8;
    color: #fff;
    font-size: 0.75rem;
    border-radius: 9px;
  }

  .cal-bbox-info {
    background:#ccc;
    margin-top:10px;
    padding:10px;
  }
</style>
