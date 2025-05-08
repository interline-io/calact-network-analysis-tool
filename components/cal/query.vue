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

        <div class="columns">
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
                @input="changeGeomSource"
              />
            </o-field>
          </div>

          <div class="column is-half" :class="{ 'is-hidden': geomSource !== 'adminBoundary' }">
            <o-field>
              <template #label>
                Boundary Type
              </template>
              <o-select
                v-model="boundaryType"
                :options="boundaryTypes"
                @input="changeBoundaryType"
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
              v-model="boundaries"
              :options="sampleBoundaryData"
              open-on-focus
              closable
              close-icon=""
              keep-open
              icon="magnify"
              placeholder="Search..."
              :filter="filterBoundaries"
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
import { type Bbox, parseBbox } from '../geom'
import { cannedBboxes, geomSources, boundaryTypes } from '../constants'
import { useToggle } from '@vueuse/core'

const props = defineProps<{
  bbox: Bbox
}>()

const emit = defineEmits([
  'setBbox',
  'explore'
])

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const geomSource = defineModel<string>('geomSource')
const boundaryType = defineModel<string>('boundaryType')
const scheduleEnabled = defineModel<boolean>('scheduleEnabled')
const cannedBbox = ref('')
const selectSingleDay = ref(true)
const toggleSelectSingleDay = useToggle(selectSingleDay)
const debugMenu = useDebugMenu()

const boundaries = ref([])
const sampleBoundaryData = {
  Q581346: 'Aloha',
  Q2587933: 'Barberton',
  Q588923: 'Bethany',
  Q1815228: 'Bull Mountain',
  Q2896285: 'Cedar Hills',
  Q2896288: 'Cedar Mill',
  Q3473327: 'Dunthorpe',
  Q3046557: 'Fairview',
  Q1815675: 'Felida',
  Q1983444: 'Garden Home-Whitford',
  Q2605832: 'Hazel Dell',
  Q1815789: 'Hockinson',
  Q3473329: 'Marlene Village',
  Q1815894: 'Minnehaha',
  Q1815903: 'Mount Vista',
  Q2889407: 'Oak Hills',
  Q2581728: 'Orchards',
  Q1815994: 'Salmon Creek',
  Q3473334: 'West Haven-Sylvan',
  Q1816149: 'West Slope',
}

/////////////////////////////////////////
/////////////////////////////////////////

// import { gql } from 'graphql-tag'
// import { useQuery } from '@vue/apollo-composable'

// const geographyQuery = gql`
// query($dataset_name: String, $search: String, $layer: String, $limit: Int=10){
//   census_datasets(where:{dataset_name:$dataset_name}) {
//     dataset_name
//     # layers # COMING SOON
//     geographies(limit: $limit, where:{layer:$layer, search:$search}) {
//       id
//       geoid
//       name
//       # geometry
//     }
//   }
// }
// `

// const { geomResult, loading, error } = useQuery(
//   geographyQuery,
//   () => ({
//     dataset_name: 'tiger2024',
//     search: geomSearch.value,
//     layer: geomLayer.value,
//     limit: 10,
//   }))

// const geomSearchLayers = computed(() => {
//   // aggregate uniq off geomResult.value.census_datasets.layers results
//   return ['tract', 'census']
// })
// const geomSearchEntities = computed(() => {
//   // aggregate off geomResult.value.census_datasets.geographies results
//   return []
// })
// const geomSearchEntitiesSelected = computed(() => {
//   // filter geomSearchEntities based on user selection
//   return []
// })

// end goal: have an array of geojson features selected by the user
//    to pass into the scenario
//    and have each stop returned by the query to include the matching geography ids

/////////////////////////////////////////
/////////////////////////////////////////

watch(() => cannedBbox.value, (cannedBboxName) => {
  if (cannedBboxName) {
    emit('setBbox', parseBbox(cannedBboxes.get(cannedBboxName)))
  }
})

const validQueryParams = computed(() => {
  return startDate.value && props.bbox?.valid
})

function changeGeomSource () {
  boundaryType.value = ''
  boundaries.value = []
}

function changeBoundaryType () {
  boundaries.value = []
}

// Which boundaries to show in the select field
// @param  option - the option to test (keys from the list of boundaries)
// @param  value  - the value to test (what the user typed)
function filterBoundaries (option: string, value: string): boolean {
  const exists = Array.from(boundaries.value).includes(option)
  if (exists) {
    return true // value was already picked, exclude it
  }
  const label = sampleBoundaryData[option]?.toLowerCase()
  const val = value.toLowerCase()
  return !label?.includes(val)
}

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
