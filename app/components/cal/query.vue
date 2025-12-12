<template>
  <div class="cal-query">
    <tl-title title="Home">
      Transit Network Explorer
    </tl-title>

    <t-msg variant="info">
      <p>Start by specifying your desired date range and geographic bounds. To explore stops, routes, and frequencies on the map and in tabular view click <em>Run Browse Query</em>. Or for more specialized analysis, click <em>Run Advanced Analysis</em>.</p>
    </t-msg>

    <div class="cal-body">
      <t-msg title="Date range">
        <t-field>
          <template #label>
            <t-tooltip text="The start date is used to define which week is used to calculate the days-of-week on which a route runs or a stop is served.">
              Start date
              <t-icon size="small" icon="information" />
            </t-tooltip>
          </template>
          <t-datepicker v-model="startDate" />
        </t-field>
        <t-field>
          <template #label>
            <t-tooltip text="By default, the end date is one week after the start date.">
              End date
              <t-icon size="small" icon="information" />
            </t-tooltip>
          </template>
          <t-datepicker v-if="!selectSingleDay" v-model="endDate" />
          <t-button @click="toggleSelectSingleDay()">
            {{ selectSingleDay ? 'Set an end date' : 'Remove end date' }}
          </t-button>
        </t-field>
      </t-msg>

      <t-msg title="Geographic Bounds">
        <div class="columns is-align-items-flex-end">
          <div class="column is-half">
            <t-field>
              <template #label>
                <t-tooltip text="Specify the area of interest for your query. The area is used to query for transit stops, as well as the routes that serve those stops. Note that routes that traverse the area without any designated stops will not be identified.">
                  Select geography by
                  <t-icon icon="information" />
                </t-tooltip>
              </template>
              <t-select v-model="geomSource">
                <option
                  v-for="[key, label] of Object.entries(geomSources)"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </t-select>
            </t-field>
          </div>

          <div class="column is-half" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
            <t-field>
              <template #label>
                Administrative boundary layer to search
              </template>
              <t-select v-model="geomLayer">
                <option
                  v-for="option of props.censusGeographyLayerOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </t-select>
            </t-field>
          </div>
        </div>

        <div class="container is-max-tablet" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
          <t-field>
            <template #label>
              Selected administrative boundaries
            </template>
            <t-taginput
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
            </t-taginput>
          </t-field>
        </div>
      </t-msg>

      <t-msg
        title="Advanced Settings"
        variant="dark"
        expandable
      >
        <div class="container is-max-tablet">
          <!-- Data to Load Section -->
          <t-field label="Data to Load">
            <t-checkbox
              v-model="includeFixedRoute"
            >
              Include Fixed-Route Transit
            </t-checkbox>
            <t-checkbox
              v-model="includeFlexAreas"
            >
              Include Flex Service Areas
            </t-checkbox>
          </t-field>

          <!-- Aggregation Section -->
          <t-field>
            <template #label>
              <t-tooltip text="Group data within the Report tab by geographic boundaries (cities, counties, etc.). This creates a summary table showing aggregated statistics for each geographic area. Currently only available when 'Stop' is selected as the data view.">
                Aggregate by Census geographic hierarchy level
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-select v-model="aggregateLayer">
              <option
                v-for="option of censusGeographyLayerOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </t-select>
          </t-field>
        </div>
      </t-msg>

      <t-msg v-if="debugMenu" title="Debug menu" variant="warning">
        <t-field label="Preset bounding box">
          <div class="is-flex is-align-items-center" style="gap: 0.5rem;">
            <t-select v-model="cannedBbox">
              <option v-for="[cannedBboxName, cannedBboxDetails] of Object.entries(cannedBboxes)" :key="cannedBboxName" :value="cannedBboxName">
                {{ cannedBboxDetails.label }}
              </option>
            </t-select>
            <t-button @click="loadExampleData">
              Load example
            </t-button>
          </div>
        </t-field>
      </t-msg>

      <div class="field has-addons">
        <t-button variant="primary" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('explore')">
          Run Browse Query
        </t-button>
        <t-button variant="primary" outlined :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('switchToAnalysisTab')">
          Run Advanced Analysis
        </t-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
import { useToggle } from '@vueuse/core'
import { useLazyQuery } from '@vue/apollo-composable'
import type { Bbox, Point } from '~~/src/core'
import { cannedBboxes, geomSources } from '~~/src/core'
import { type CensusDataset, type CensusGeography, geographySearchQuery } from '~~/src/tl'

const emit = defineEmits([
  'setBbox',
  'explore',
  'loadExampleData',
  'switchToAnalysisTab'
])

const loadExampleData = async () => {
  emit('loadExampleData', cannedBbox.value)
}

const props = defineProps<{
  censusGeographyLayerOptions: { label: string, value: string }[]
  mapExtentCenter: Point | null
}>()

const bbox = defineModel<Bbox>('bbox', { default: null })
const geographyIds = defineModel<number[] | undefined>('geographyIds')
const censusGeographiesSelected = defineModel<CensusGeography[]>('censusGeographiesSelected', { default: [] })
const aggregateLayer = defineModel<string>('aggregateLayer', { default: 'tract' })
const includeFixedRoute = defineModel<boolean>('includeFixedRoute', { default: true })
const includeFlexAreas = defineModel<boolean>('includeFlexAreas', { default: true })
const geomLayer = ref('place')
const cannedBbox = defineModel<string>('cannedBbox', { default: '' })
const debugMenu = useDebugMenu()
const endDate = defineModel<Date | undefined>('endDate')
const geomSearch = ref('')
const geomSource = defineModel<string | undefined>('geomSource')
const selectSingleDay = ref(true)
const startDate = defineModel<Date | undefined>('startDate')
const toggleSelectSingleDay = useToggle(selectSingleDay)

const geomSearchVars = computed(() => {
  return {
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
    // Clear selected geographies when switching away from Administrative Boundary
    geographyIds.value = []
    censusGeographiesSelected.value = []
    geomSearch.value = ''
    // Clear search results
    geomResult.value = undefined
  }
})

const selectedGeographyTagOptions = computed((): { value: number, label: string }[] => {
  // Combine both the selected geographies and the search results
  const geogs: CensusGeography[] = []
  for (const geo of censusGeographiesSelected.value || []) {
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

/////////////////////////////////////////
/////////////////////////////////////////

const validQueryParams = computed(() => {
  const hasValidDate = startDate.value
  const hasValidBounds = bbox?.value?.valid

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
    max-width: 800px;
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    padding-left:20px;
    padding-right:20px;
    > .cal-body {
      > div, > article {
        margin-bottom:10px;
      }
    }
  }

  .cal-bbox-info {
    background:#ccc;
    margin-top:10px;
    padding:10px;
  }
</style>
