<template>
  <div class="cal-query">
    <tl-title title="Home">
      Transit Network Explorer
    </tl-title>

    <tl-msg-info>
      Specify your desired date range and geographic bounds. Then click <em>Run Query</em>.
    </tl-msg-info>

    <div class="cal-body">
      <tl-msg-box variant="text" title="Date range">
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

      <tl-msg-box variant="text" title="Geographic Bounds">
        <tl-msg-warning v-if="debugMenu" class="mt-4" style="width:400px" title="Debug menu">
          <o-field label="Preset bounding box">
            <o-select v-model="cannedBbox">
              <option v-for="cannedBboxName of cannedBboxes.keys()" :key="cannedBboxName" :value="cannedBboxName">
                {{ cannedBboxName }}
              </option>
            </o-select>
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
                <o-tooltip multiline label="Specify the area of interest for your query. In the future, there will be additional options including selection of Census geographies. The area is used to query for transit stops, as well as the routes that serve those stops. Note that routes that traverse the area without any designated stops will not be identified.">
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
                Boundary Type
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
              Include Boundaries
            </template>
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
            </o-taginput>
          </o-field>
        </div>
      </tl-msg-box>

      <o-button variant="primary" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('explore')">
        Run Query
      </o-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Bbox, type Point, type Feature, parseBbox } from '../geom'
import { cannedBboxes, geomSources } from '../constants'
import { type CensusDataset, type CensusGeography, geographySearchQuery } from '../census'
import { useToggle } from '@vueuse/core'
import { useLazyQuery } from '@vue/apollo-composable'

const emit = defineEmits([
  'setBbox',
  'explore'
])

const props = defineProps<{
  censusGeographyLayerOptions: { label: string, value: string }[]
  mapExtentCenter: Point | null
}>()

const bbox = defineModel<Bbox>('bbox', { default: null })
const geographyIds = defineModel<number[]>('geographyIds')
const censusGeographiesSelected = defineModel<CensusGeography[]>('censusGeographiesSelected', { default: [] })
const cannedBbox = ref('')
const debugMenu = useDebugMenu()
const endDate = defineModel<Date>('endDate')
const geomLayer = defineModel<string>('geomLayer')
const geomSearch = ref('')
const geomSource = defineModel<string>('geomSource')
const scheduleEnabled = defineModel<boolean>('scheduleEnabled')
const selectSingleDay = ref(true)
const startDate = defineModel<Date>('startDate')
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
    geomLoad(geographySearchQuery) || geomRefetch()
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
    let label = `${geo.name}${stateDesc} (${geo.layer.description || geo.layer.name})`
    results.push({ value: geo.id, label })
  }
  return results
})

/////////////////////////////////////////
/////////////////////////////////////////

watch(() => cannedBbox.value, (cannedBboxName) => {
  if (cannedBboxName) {
    emit('setBbox', parseBbox(cannedBboxes.get(cannedBboxName) || null))
  }
})

const validQueryParams = computed(() => {
  return startDate.value && bbox?.value?.valid
})

</script>

<style scoped lang="scss">
  .cal-query {
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
