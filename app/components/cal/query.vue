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

    <!-- A named form makes the query controls a landmark screen reader
         users can jump to. All buttons inside are type=button and the
         widgets consume their own Enter keys, so there is no implicit
         submission; submit.prevent guards the residual cases. -->
    <form
      class="cal-body"
      :class="{ 'is-locked': props.scenarioLoaded }"
      aria-label="Transit network query parameters"
      @submit.prevent
    >
      <cat-msg title="Date range" variant="dark">
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
          />
        </cat-field>
        <cal-end-date-field
          v-model:end="endDate"
          v-model:single-day="selectSingleDay"
          :min-date="pickerMinDate"
          :max-date="pickerMaxDate"
          :years-range="datePickerYearsRange"
          :invalid="!(isEndDateInRange && isEndDateValid)"
          :before-start="!isEndDateValid"
          single-day-title="Remove end date (query a single day)"
        >
          <template #label>
            <cat-tooltip text="By default, the end date is one week after the start date.">
              End date
              <cat-icon size="small" icon="information" />
            </cat-tooltip>
          </template>
        </cal-end-date-field>
        <p v-if="!isStartDateInRange || !isEndDateInRange" class="help is-danger">
          Dates must be between {{ fmtDate(validMinDate, 'MMM d, yyyy') }} (the
          start of the Feed Archive) and {{ fmtDate(validMaxDate, 'MMM d, yyyy') }}.
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

      <cat-msg title="Geographic Bounds" variant="dark">
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

          <cat-field label="Selected administrative boundaries">
            <!-- Real buttons outside the label element: the previous href-less
                 anchors inside the label slot were keyboard-unreachable and
                 their text polluted the taginput's accessible name. -->
            <div v-if="geographyIds.length > 0" class="cal-boundary-actions">
              <cat-button
                v-if="props.savedGeographyAccess?.save"
                variant="ghost"
                size="small"
                :disabled="!adminSaveReady"
                @click="showSaveModal = true"
              >
                Save boundaries…
              </cat-button>
              <cat-button variant="ghost" size="small" @click="emit('fitToGeographies')">
                Show on map
              </cat-button>
              <cat-button variant="ghost" size="small" @click="emit('clearGeographies')">
                Clear all
              </cat-button>
            </div>
            <cat-taginput
              v-model="geographyIds"
              v-model:input="geomSearch"
              :open-on-focus="true"
              :options="selectedGeographyTagOptions"
              icon="magnify"
              placeholder="Search..."
              fullwidth
              :loading="geomResultLoading"
              @select="emit('fitToGeographies')"
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
        </div>

        <div v-if="geomSource === 'custom'" class="container is-max-tablet">
          <!-- A wizard of sorts: choose saved boundaries or upload a file
               (Upload a new file adds one with boundaries chosen); review the
               file's features, with Cancel to discard it; saving returns to
               the saved boundaries with the new one chosen. -->
          <cal-saved-geography-picker
            v-if="props.savedGeographyAccess?.list && !upload && !addingFile"
            v-model="savedGeographies"
          />
          <cal-geography-upload v-if="upload || addingFile || savedGeographies.length === 0" @show-on-map="emit('fitToGeographies')" />
          <template v-else>
            <p v-if="props.savedGeographyLoading" class="help">
              <cat-icon icon="loading" size="small" />
              Loading the saved boundaries...
            </p>
            <p
              v-for="message of props.savedGeographyMessages || []"
              :key="message.text"
              class="help"
              :class="message.variant === 'danger' ? 'is-danger' : 'has-text-warning-dark'"
              role="alert"
            >
              {{ message.text }}
            </p>
          </template>
          <!-- Left, a way out of or into uploading; right, the step's actions -->
          <div class="level is-mobile mt-2">
            <div class="level-left">
              <cat-button v-if="upload || addingFile" size="small" @click="cancelUpload">
                Cancel
              </cat-button>
              <cat-button v-else-if="savedGeographies.length > 0" size="small" icon-left="cloud-upload" @click="addingFile = true">
                Upload a new file…
              </cat-button>
            </div>
            <div class="level-right">
              <cat-button
                v-if="upload && props.savedGeographyAccess?.save"
                size="small"
                :disabled="!upload.result"
                @click="showSaveModal = true"
              >
                Save GeoJSON bounds…
              </cat-button>
              <div v-else-if="!upload && !addingFile" class="field is-grouped">
                <div v-if="props.savedGeographyManageUrl" class="control">
                  <a v-bind="manageLinkAttrs" class="button is-small">
                    <span>Manage saved boundaries<span class="is-sr-only"> (opens in a new tab)</span></span>
                    <cat-icon icon="open-in-new" size="small" />
                  </a>
                </div>
                <cat-button
                  v-if="savedGeographies.length > 0 && (props.queryPolygon || (props.censusGeographiesSelected?.length ?? 0) > 0)"
                  size="small"
                  @click="emit('fitToGeographies')"
                >
                  Show on map
                </cat-button>
              </div>
            </div>
          </div>
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
            <ul class="cal-query-data-toggles">
              <li>
                <cat-checkbox v-model="includeFixedRoute">
                  Include Fixed-Route Transit
                </cat-checkbox>
              </li>
              <li>
                <cat-checkbox v-model="includeFlexAreas">
                  Include Flex Service Areas
                </cat-checkbox>
              </li>
              <li>
                <cat-checkbox v-model="includeCensus">
                  Include Census Demographics
                </cat-checkbox>
                <cat-tooltip text="Census (ACS) demographic values for aggregation areas and stop statistical radius buffers. Uncheck to skip loading demographics; demographic columns and area details will be unavailable.">
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </li>
            </ul>
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
          </div>
        </cat-field>
        <cat-field label="GraphQL requests">
          <cat-select v-model="fetchMode">
            <option value="bff">
              From the server (BFF)
            </option>
            <option value="direct">
              From the browser (direct)
            </option>
          </cat-select>
        </cat-field>
      </cat-msg>

      <div class="field has-addons cal-query-actions">
        <cat-button variant="primary" :disabled="!validQueryParams" v-bind="runButtonA11y" class="is-fullwidth is-large" @click="emit('explore')">
          Run Browse Query
        </cat-button>
        <cat-button variant="primary" outlined :disabled="!validQueryParams" v-bind="runButtonA11y" class="is-fullwidth is-large" @click="emit('switchToAnalysisTab')">
          Run Advanced Analysis
        </cat-button>
      </div>
      <!-- Explains why the run buttons are disabled (#390: a screen reader
           user could not tell). Referenced by both buttons via
           aria-describedby, and always rendered so the polite live region
           reliably announces when the blocker appears or clears. -->
      <p
        id="cal-query-blocked-reason"
        class="help cal-query-blocked-reason"
        :class="{ 'is-danger': queryBlockedReason }"
        aria-live="polite"
      >
        {{ queryBlockedReason }}
      </p>
    </form>

    <cal-feed-version-picker-modal
      v-model:open="showFvPicker"
      :start-date="startDate"
      :end-date="endDate"
      :fvids="fvids"
      :bbox="pickerBbox"
      @apply="onModalApply"
    />

    <cal-save-geography-modal
      v-model:open="showSaveModal"
      :request="saveRequest"
      @saved="onGeographySaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useLazyQuery } from '@vue/apollo-composable'
import {
  asDateString,
  bboxMetadata,
  cannedBboxes,
  fmtDate,
  geomSources,
  mergePolygons,
  normalizeDate,
  PANEL_PADDING,
  polygonBbox,
  QUERY_PANEL_WIDTH,
  suggestUploadName,
  uploadFeatureCollection,
  validEndDate,
  wideMaxAllowedDate,
  wideMinAllowedDate,
  type Point,
  type PolygonalGeometry,
  type QueryPolygon,
  type SavedGeography,
  type SaveGeographyRequest,
} from '~~/src/core'
import { type CensusDataset, type CensusGeography, geographySearchQuery, parseFvids } from '~~/src/tl'
import CalFeedVersionPickerModal from '~/components/cal/feed-version-picker-modal.vue'
import CalFeedVersionOverrideSummary from '~/components/cal/feed-version-override-summary.vue'
import CalEndDateField from '~/components/cal/end-date-field.vue'
import { useFetchMode } from '~/composables/useFetchMode'
import { useUploadedGeography } from '~/composables/useUploadedGeography'
import type { SavedGeographyAccess } from '~/composables/useSavedGeographies'
import type { QueryGeographyMessage, SavedSelectionKind } from '~/composables/useQueryGeography'
import CalGeographyUpload from '~/components/cal/geography-upload.vue'
import CalSavedGeographyPicker from '~/components/cal/saved-geography-picker.vue'
import CalSaveGeographyModal from '~/components/cal/save-geography-modal.vue'

const emit = defineEmits([
  'fitToGeographies',
  'clearGeographies',
  'explore',
  'switchToAnalysisTab',
  'resetScenario',
  // A file was saved as a boundary, so its polygon is already in hand
  'uploadSaved',
])

const props = defineProps<{
  censusGeographyLayerOptions: { label: string, value: string }[]
  viewportGeographies?: CensusGeography[]
  viewportGeographiesLoading?: boolean
  viewportGeographiesLimit?: number
  mapExtentCenter?: Point
  censusGeographiesSelected?: CensusGeography[]
  scenarioLoaded?: boolean
  // The uploaded or saved area a query would run on
  queryPolygon?: QueryPolygon
  // What the user's Interline plan allows with saved geographies
  savedGeographyAccess?: SavedGeographyAccess
  savedGeographyLoading?: boolean
  // The chosen saved boundaries have loaded and can run together
  savedSelectionRunnable?: boolean
  // Where the user can download or delete saved boundaries
  savedGeographyManageUrl?: string
  // What kind of saved boundaries are chosen
  savedSelectionKind?: SavedSelectionKind
  // Problems loading the chosen saved geography
  savedGeographyMessages?: QueryGeographyMessage[]
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
  savedGeographies,
  geoDatasetName,
  includeFixedRoute,
  includeFlexAreas,
  includeCensus,
  fvids,
  applyDatesAndFvids,
} = useScenarioInputs()
const { upload, clear: clearUpload } = useUploadedGeography()
// Adding a file with saved boundaries already chosen, before it's read
const addingFile = ref(false)
function cancelUpload () {
  clearUpload()
  addingFile.value = false
}
const { showToast } = useToastNotification()

const showFvPicker = ref(false)
const fvOverrideCount = computed(() => {
  const parsed = parseFvids(fvids.value)
  return parsed.picks.size + parsed.excluded.size
})
const { aggregateLayer } = useScenarioDisplay()
const debugMenu = useDebugMenu()
const fetchMode = useFetchMode()
const geomSearch = ref('')
// Single-day mode is an explicit opt-in: derived from the committed dates on
// load (a shared single-day link shows single-day mode), defaulting to the
// full week otherwise. Downstream analysis — day-of-week filters, WSDOT
// weekday/weekend levels, stop visit summaries — assumes a 7-day window, so
// the default range stays start + 6 days.
const selectSingleDay = ref(asDateString(startDate.value) === asDateString(endDate.value))

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

// When toggling single-day mode, sync endDate to the URL query params.
// In single-day mode, endDate matches startDate. When switching to range mode,
// we create a copy so Vue detects a change and persists the value to the URL.
// (Keyboard focus across the toggle is handled inside cal-end-date-field, #361.)
// Suppressed during a modal Apply — the modal commits its own (already
// consistent) dates in a single batched URL write.
let suppressSingleDayWatch = false
watch(selectSingleDay, (newVal) => {
  if (suppressSingleDayWatch) {
    return
  }
  if (newVal) {
    endDate.value = startDate.value
  } else {
    endDate.value = new Date(endDate.value)
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
  } else if (oldValue === 'adminBoundary') {
    // Clear selected geographies when switching away from Administrative Boundary.
    // censusGeographiesSelected upstream is computed from geographyIds so it
    // updates automatically once we clear the IDs.
    geographyIds.value = []
    geomSearch.value = ''
    geomResult.value = undefined
  }
  if (oldValue === 'custom') {
    savedGeographies.value = []
  }
})

// The feed archive picker searches around the uploaded or saved boundary
const pickerBbox = computed(() => polygonBbox(props.queryPolygon) ?? bbox.value)

// The page in the user's Interline account that lists their saved boundaries
const manageLinkAttrs = computed(() => ({
  href: props.savedGeographyManageUrl,
  target: '_blank',
  rel: 'noopener',
  title: 'View, download or delete your saved boundaries in your Interline account',
}))

// Saving: what the modal saves, from the upload or the selected boundaries
const showSaveModal = ref(false)

// The selected boundaries' geometry arrives after their ids
const adminSaveReady = computed(() => {
  const loaded = new Set((props.censusGeographiesSelected || []).map(g => g.id))
  return geographyIds.value.length > 0 && geographyIds.value.every(id => loaded.has(id))
})

// Built only while the modal is open, as it copies the whole upload
const saveRequest = computed((): SaveGeographyRequest | null => {
  if (!showSaveModal.value) {
    return null
  }
  if (geomSource.value === 'custom' && upload.value?.result) {
    const { filename } = upload.value
    const { features, polygon, vertexCount } = upload.value.result
    return {
      defaultName: suggestUploadName(filename, features),
      summary: `${features.length} ${features.length === 1 ? 'feature' : 'features'} from ${filename}, with ${vertexCount.toLocaleString()} points.`,
      geography: {
        metadata: { source: 'upload', bbox: bboxMetadata(polygonBbox(polygon)), feature_count: features.length, filename },
        content: uploadFeatureCollection(features),
      },
    }
  }
  if (geomSource.value === 'adminBoundary' && adminSaveReady.value) {
    const geos = props.censusGeographiesSelected || []
    const names = geos.map(g => g.adm1_name ? `${g.name}, ${g.adm1_name}` : g.name)
    const outlines = geos.map(g => g.geometry).filter((g): g is PolygonalGeometry => g?.type === 'Polygon' || g?.type === 'MultiPolygon')
    return {
      defaultName: names.length <= 3 ? names.join('; ') : `${names.slice(0, 2).join('; ')} and ${names.length - 2} more`,
      summary: `${geos.length} administrative ${geos.length === 1 ? 'boundary' : 'boundaries'}: ${names.join('; ')}.`,
      geography: {
        metadata: { source: 'admin_boundary', bbox: bboxMetadata(polygonBbox(mergePolygons(outlines))), feature_count: geos.length, dataset: geoDatasetName.value },
        content: {
          type: 'admin_boundaries',
          dataset: geoDatasetName.value,
          geographies: geos.map(g => ({ id: g.id, geoid: g.geoid, name: g.name, layer: g.layer?.name ?? '' })),
        },
      },
    }
  }
  return null
})

// A saved upload is chosen from the saved list from then on, so the URL can
// name it. Saved boundaries are already in the URL as their ids.
function onGeographySaved (saved: SavedGeography) {
  showToast(`Saved "${saved.name}" to your profile`, 'success')
  if (geomSource.value === 'custom') {
    if (upload.value?.result) {
      emit('uploadSaved', { id: saved.id, name: saved.name, polygon: upload.value.result.polygon })
    }
    // Added to chosen uploads; it can't join Census boundary sets, so it
    // replaces them
    savedGeographies.value = props.savedSelectionKind === 'upload'
      ? [...savedGeographies.value, saved.id]
      : [saved.id]
    // The upload is saved, so the next upload starts afresh
    cancelUpload()
  }
}

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

// Spread as a v-bind object typed as a plain record: strictTemplates rejects
// undeclared attributes written directly on a component, but aria-describedby
// is a legitimate fallthrough attr that cat-button forwards to its native
// button element.
const runButtonA11y: Record<string, string> = { 'aria-describedby': 'cal-query-blocked-reason' }

// Human-readable reason the run buttons are disabled, shown below them and
// referenced via aria-describedby (#390). Empty when the query is runnable.
const queryBlockedReason = computed(() => {
  if (validQueryParams.value) {
    return ''
  }
  if (!startDate.value) {
    return 'Cannot run query yet: select a start date.'
  }
  if (!isStartDateInRange.value || !isEndDateInRange.value) {
    return 'Cannot run query: dates are outside the Feed Archive range.'
  }
  if (!isEndDateValid.value) {
    return 'Cannot run query: the end date is before the start date.'
  }
  if (geomSource.value === 'adminBoundary' && (geographyIds.value?.length ?? 0) === 0) {
    return 'Cannot run query: select at least one administrative boundary.'
  }
  if (geomSource.value === 'custom') {
    if (upload.value) {
      return 'Cannot run query: choose at least one feature from the file.'
    }
    if (savedGeographies.value.length > 0) {
      return props.savedGeographyLoading
        ? 'Cannot run query: the saved boundaries haven\'t loaded.'
        : 'Cannot run query: the chosen saved boundaries can\'t run together.'
    }
    return 'Cannot run query: choose a saved boundary or upload a GeoJSON file.'
  }
  if (!bbox?.value?.valid) {
    return 'Cannot run query: set the geographic bounds first.'
  }
  return 'Cannot run query: required parameters are missing.'
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

  // An uploaded area, or a saved one: its polygon, or its boundaries' ids
  // A file being reviewed is the area, ahead of any chosen saved boundaries
  if (geomSource.value === 'custom') {
    if (savedGeographies.value.length > 0 && !upload.value) {
      return hasValidDate && !!props.savedSelectionRunnable
    }
    return hasValidDate && !!props.queryPolygon
  }

  // For other modes (bbox, map extent), use existing validation
  return hasValidDate && hasValidBounds
})
</script>

<style scoped lang="scss">
  .cal-boundary-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .cal-query {
    max-width: v-bind(panelWidthPx);
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    overflow-y: auto;
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

  // One toggle per line — the panel is too narrow for inline checkbox flow.
  .cal-query-data-toggles {
    list-style: none;
    margin: 0;
    padding: 0;
    > li {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
  }

  // Indented under "Include Fixed-Route Transit" — departures are a subset
  // of fixed-route data (1.625rem = checkbox width + label gap).
  .cal-query-data-toggles-nested {
    margin-left: 1.625rem;
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
