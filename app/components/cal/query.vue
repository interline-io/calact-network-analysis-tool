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
            :min-date="minAllowedDate"
            :max-date="maxAllowedDate"
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
          <cat-datepicker
            v-if="!selectSingleDay"
            v-model="endDate"
            :min-date="minAllowedDate"
            :max-date="maxAllowedDate"
            :years-range="datePickerYearsRange"
            :variant="isEndDateInRange && isEndDateValid ? undefined : 'danger'"
            readonly
          />
          <cat-button @click="toggleSelectSingleDay()">
            {{ selectSingleDay ? 'Set an end date' : 'Remove end date' }}
          </cat-button>
          <p v-if="!isEndDateValid" class="help is-danger">
            End date must be on or after the start date.
          </p>
        </cat-field>
        <p v-if="!isStartDateInRange || !isEndDateInRange" class="help is-danger">
          Dates must be within the last 90 days or next year.
        </p>
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useToggle } from '@vueuse/core'
import { useLazyQuery } from '@vue/apollo-composable'
import type { Point } from '~~/src/core'
import { cannedBboxes, geomSources, normalizeDate, PANEL_PADDING, QUERY_PANEL_WIDTH } from '~~/src/core'
import { type CensusDataset, type CensusGeography, geographySearchQuery } from '~~/src/tl'

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
} = useScenarioInputs()
const { aggregateLayer } = useScenarioDisplay()
const debugMenu = useDebugMenu()
const geomSearch = ref('')
const selectSingleDay = ref(true)
const toggleSelectSingleDay = useToggle(selectSingleDay)

// Transitland API results are currently based on only active feed versions,
// so we want to constrain possible query dates.
// In future, user-controlled import of historical feeds will be a fuller solution,
// see https://github.com/interline-io/calact-network-analysis-tool/issues/223
const today = new Date()
const minAllowedDate = new Date(today)
minAllowedDate.setDate(today.getDate() - 90)
const maxAllowedDate = new Date(today)
maxAllowedDate.setFullYear(today.getFullYear() + 1)
// yearsRange is relative offsets [before, after] from current year for the year dropdown
const datePickerYearsRange: [number, number] = [-1, 1]

function isDateInRange (d: Date | undefined): boolean {
  const date = normalizeDate(d)
  if (!date) {
    return true
  }
  return date >= minAllowedDate && date <= maxAllowedDate
}

const isStartDateInRange = computed(() => isDateInRange(startDate.value))
const isEndDateInRange = computed(() => isDateInRange(endDate.value))

const isEndDateValid = computed(() => {
  if (selectSingleDay.value) {
    return true
  }
  // Both dates should already be normalized, but compare date portions to be safe
  const start = normalizeDate(startDate.value)
  const end = normalizeDate(endDate.value)
  if (!start || !end) {
    return false
  }
  return end >= start
})

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

// When toggling single-day mode, sync endDate to the URL query params.
// In single-day mode, endDate matches startDate. When switching to range mode,
// we create a copy so Vue detects a change and persists the value to the URL.
watch(selectSingleDay, (newVal) => {
  if (newVal) {
    endDate.value = startDate.value
  } else {
    endDate.value = new Date(endDate.value)
  }
})

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

  .cal-bbox-info {
    background:#ccc;
    margin-top:10px;
    padding:10px;
  }
</style>
