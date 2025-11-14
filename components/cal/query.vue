<template>
  <div class="cal-query">
    <tl-title title="Home">
      Transit Network Explorer
    </tl-title>

    <tl-msg-info>
      <p>Start by specifying your desired date range and geographic bounds. To explore stops, routes, and frequencies on the map and in tabular view click <em>Run Browse Query</em>. Or for more specialized analysis, click <em>Run Advanced Analysis</em>.</p>
    </tl-msg-info>

    <div class="cal-body">
      <tl-msg-box title="Date range">
        <o-field>
          <template #label>
            <o-tooltip multiline label="The start date is used to define which week is used to calculate the days-of-week on which a route runs or a stop is served.">
              Start date
              <o-icon icon="information" />
            </o-tooltip>
          </template>
          <o-datepicker v-model="startDate" />
        </o-field>
        <o-field addons>
          <template #label>
            <o-tooltip multiline label="By default, the end date is one week after the start date.">
              End date
              <o-icon icon="information" />
            </o-tooltip>
          </template>
          <o-datepicker v-if="!selectSingleDay" v-model="endDate" />
          <o-button @click="toggleSelectSingleDay()">
            {{ selectSingleDay ? 'Set an end date' : 'Remove end date' }}
          </o-button>
        </o-field>
      </tl-msg-box>

      <tl-msg-box title="Geographic Bounds">
        <tl-msg-warning v-if="debugMenu" class="mt-4" style="width:400px" title="Debug menu">
          <o-field label="Preset bounding box">
            <o-select v-model="cannedBbox">
              <option v-for="[cannedBboxName, cannedBboxDetails] of cannedBboxes.entries()" :key="cannedBboxName" :value="cannedBboxName">
                {{ cannedBboxDetails.label }}
              </option>
            </o-select>
            <o-button @click="loadExampleData">
              Load example
            </o-button>
          </o-field>
          <br>
          <o-field label="Data options">
            <o-checkbox
              v-model="scheduleEnabled"
              :true-value="true"
              :false-value="false"
            >
              Load schedule data
            </o-checkbox>
          </o-field>
        </tl-msg-warning>

        <div class="columns is-align-items-flex-end">
          <div class="column is-half">
            <o-field>
              <template #label>
                <o-tooltip multiline label="Specify the area of interest for your query. The area is used to query for transit stops, as well as the routes that serve those stops. Note that routes that traverse the area without any designated stops will not be identified.">
                  Select geography by
                  <o-icon icon="information" />
                </o-tooltip>
              </template>
              <o-select
                v-model="geomSource"
                :options="geomSources"
              />
            </o-field>
          </div>

          <div class="column is-half" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
            <o-field>
              <template #label>
                Administrative boundary layer to search
              </template>
              <o-select
                v-model="geomLayer"
                :options="props.censusGeographyLayerOptions"
              />
            </o-field>
          </div>
        </div>

        <div class="container is-max-tablet" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
          <o-field>
            <template #label>
              Selected administrative boundaries
            </template>
            <div class="field has-addons">
              <div class="control is-expanded">
                <o-taginput
                  v-model="geographyIds"
                  v-model:input="geomSearch"
                  :open-on-focus="true"
                  :options="selectedGeographyTagOptions"
                  close-icon=""
                  icon="magnify"
                  placeholder="Search..."
                  expanded
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
                </o-taginput>
              </div>
              <div v-if="geomResultLoading" class="control">
                <o-loading
                  :active="true"
                  :full-page="false"
                  size="small"
                />
              </div>
            </div>
          </o-field>
        </div>
      </tl-msg-box>

      <article class="message mb-4 is-text">
        <div class="message-header collapsible-header" @click="() => toggleAdvancedSettings()">
          <span class="message-header-title">
            Advanced Settings
          </span>
          <span class="message-header-icon">
            <o-icon :icon="showAdvancedSettings ? 'menu-up' : 'menu-down'" />
          </span>
        </div>
        <o-collapse
          :open="showAdvancedSettings"
          animation="slide"
        >
          <div class="message-body">
            <div class="container is-max-tablet">
              <o-field>
                <template #label>
                  <o-tooltip multiline label="Group data within the Report tab by geographic boundaries (cities, counties, etc.). This creates a summary table showing aggregated statistics for each geographic area. Currently only available when 'Stop' is selected as the data view.">
                    Aggregate by Census geographic hierarchy level: <o-icon icon="information" />
                  </o-tooltip>
                </template>
                <o-select
                  v-model="aggregateLayer"
                  :options="censusGeographyLayerOptions"
                />
              </o-field>
            </div>
          </div>
        </o-collapse>
      </article>

      <div class="field has-addons">
        <o-button variant="primary" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('explore')">
          Run Browse Query
        </o-button>
        <o-button variant="primary-outline" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('switchToAnalysisTab')">
          Run Advanced Analysis
        </o-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
import { useToggle } from '@vueuse/core'
import { useLazyQuery } from '@vue/apollo-composable'
import type { Bbox, Point } from '~/src/core'
import { cannedBboxes, geomSources } from '~/src/core'
import { type CensusDataset, type CensusGeography, geographySearchQuery } from '~/src/tl'

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
const geographyIds = defineModel<number[]>('geographyIds')
const censusGeographiesSelected = defineModel<CensusGeography[]>('censusGeographiesSelected', { default: [] })
const aggregateLayer = defineModel<string>('aggregateLayer', { default: 'tract' })
const geomLayer = ref('place')
const cannedBbox = defineModel<string>('cannedBbox', { default: null })
const debugMenu = useDebugMenu()
const endDate = defineModel<Date>('endDate')
const geomSearch = ref('')
const geomSource = defineModel<string>('geomSource')
const scheduleEnabled = defineModel<boolean>('scheduleEnabled')
const selectSingleDay = ref(true)
const showAdvancedSettings = ref(false)
const startDate = defineModel<Date>('startDate')
const toggleSelectSingleDay = useToggle(selectSingleDay)
const toggleAdvancedSettings = useToggle(showAdvancedSettings)

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
