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
                :options="props.geomDatasetLayerOptions"
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
              v-model="geomSelected"
              v-model:input="geomSearch"
              :options="geomSelectedOptions"
              :filter="geomFilter"
              close-icon=""
              icon="magnify"
              placeholder="Search..."
              expanded
            />
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
import { type Bbox, type Point, type Feature, type Geometry, parseBbox } from '../geom'
import { cannedBboxes, geomSources } from '../constants'
import { type CensusDataset, type CensusGeography, geographySearchQuery } from '../census'
import { useToggle } from '@vueuse/core'
import { useQuery } from '@vue/apollo-composable'

const emit = defineEmits([
  'setBbox',
  'setSelectedFeatures',
  'explore'
])

const props = defineProps<{
  geomDatasetLayerOptions: { label: string, value: string }[]
  mapExtentCenter: Point | null
}>()

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const scheduleEnabled = defineModel<boolean>('scheduleEnabled')
const geomSource = defineModel<string>('geomSource')
const geomLayer = defineModel<string>('geomLayer')
const bbox = defineModel<Bbox>('bbox', { default: null })

const geomSelected = ref<CensusGeography[]>([])
const cannedBbox = ref('')
const selectSingleDay = ref(true)
const debugMenu = useDebugMenu()
const toggleSelectSingleDay = useToggle(selectSingleDay)
const geomSearch = ref('')

const {
  result: geomResult,
} = useQuery<{ census_datasets: CensusDataset[] }>(
  geographySearchQuery,
  () => ({
    layer: geomLayer.value,
    search: geomSearch.value,
    limit: 10,
    focus: props.mapExtentCenter,
  }), {
    debounce: 50,
    keepPreviousResult: true
  }
)

const geomSelectedOptions = computed(() => {
  // Add dataset_name, dataset_desc
  const geogs: CensusGeography[] = []
  for (const ds of geomResult.value?.census_datasets || []) {
    for (const geo of ds.geographies || []) {
      geogs.push({
        ...geo,
        dataset_name: ds.name,
        dataset_description: ds.description,
      })
    }
  }

  // "options" must include the already selected geographies, otherwise the label will not work
  const options = new Map<number, CensusGeography>()
  const selected = geomSelected.value || []
  for (const geo of selected) {
    options.set(geo.id, geo)
  }

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
    let label = `${geo.adm1_name}: ${geo.name} (${geo.dataset_description || geo.dataset_name}: ${geo.layer.description || geo.layer.name})`
    results.push({ value: geo, label })
  }
  return results
})

// Which options to include in the select dropdown
// @param  option - the option to test (items in the options array)
// @param  value  - the value to test (what the user typed)
function geomFilter (option: any, value: string): boolean {
  const selected = geomSelected.value || []
  for (const geo of selected) {
    if (geo.id === option?.id) {
      return true // value was already selected, exclude it from dropdown
    }
  }
  return false
}

// end goal: have an array of geojson features selected by the user
//    to pass into the scenario
//    and have each stop returned by the query to include the matching geography ids

/////////////////////////////////////////
/////////////////////////////////////////

watch(() => cannedBbox.value, (cannedBboxName) => {
  if (cannedBboxName) {
    emit('setBbox', parseBbox(cannedBboxes.get(cannedBboxName) || null))
  }
})

watch(geomSelected, () => {
  const selected = geomSelected.value || []
  const features = []

  for (const geo of selected) {
    features.push({
      type: 'Feature',
      geometry: geo.geometry,
      id: geo.id,
      properties: {
        id: geo.geoid,
        name: geo.name,
        layer_name: geo.layer_name,
        geoid: geo.geoid
      }
    })
  }
  emit('setSelectedFeatures', features)
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
