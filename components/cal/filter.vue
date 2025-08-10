<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <tl-title title="Filters" />

      <aside class="menu">
        <p class="menu-label">
          Filters
        </p>
        <o-button class="mx-4 mb-4" icon-left="delete" @click="emit('resetFilters')">
          Clear all
        </o-button>
        <ul class="menu-list">
          <li v-for="item of menuItems" :key="item.tab">
            <a :class="{ 'is-active': activeTab === item.tab }" @click="setTab(item.tab)">
              <o-icon
                :icon="item.icon"
                class="is-fullwidth"
              />
              {{ item.label }}
              <o-icon class="right-chev" icon="chevron-right" size="small" />
            </a>
          </li>
        </ul>
      </aside>

      <div class="cal-filter-summary">
        <p>
          Showing data for:<br>
          {{ fmtDate(startDate || null) }}
          <span v-if="endDate">
            - {{ fmtDate(endDate) }}
          </span>
        </p>
        <p>
          <o-button>bounding box</o-button>
        </p>
        <p>
          <a>Change date or region</a>
        </p>
      </div>
    </div>

    <div v-if="activeTab" class="cal-filter-sub">
      <div>
        <o-icon
          icon="chevron-left"
          class="is-pulled-right"
          size="large"
          @click="setTab('')"
        />
      </div>

      <!-- TIMEFRAMES -->
      <div v-if="activeTab === 'timeframes'">
        <aside class="cal-filter-days menu block">
          <p class="menu-label">
            Days of the week
          </p>

          <section class="cal-day-of-week-mode menu-list">
            <o-field>
              <o-radio
                v-model="selectedDayOfWeekMode"
                name="selectedDayOfWeekMode"
                native-value="Any"
                label="Any of the following days"
                :disabled="!stopDepartureLoadingComplete"
              />
            </o-field>
            <o-field>
              <o-radio
                v-model="selectedDayOfWeekMode"
                name="selectedDayOfWeekMode"
                native-value="All"
                label="All of the following days"
                :disabled="!stopDepartureLoadingComplete"
              />
            </o-field>
          </section>

          <ul>
            <li v-for="dowValue of dowValues" :key="dowValue">
              <o-checkbox
                v-model="selectedDays"
                :native-value="dowValue"
                :label="dowValue"
                :disabled="!stopDepartureLoadingComplete || !dowAvailable.has(dowValue)"
              />
            </li>
          </ul>

          <p v-if="!stopDepartureLoadingComplete">
            Loading...
          </p>
        </aside>

        <aside class="cal-filter-times menu block">
          <p class="menu-label">
            Time of Day
          </p>

          <o-field class="cal-time-of-day-mode">
            <o-checkbox
              v-model="selectedTimeOfDayMode"
              label="All Day"
              true-value="All"
              false-value="Partial"
              :disabled="!stopDepartureLoadingComplete"
            />
          </o-field>

          <p class="menu-label">
            Starting
          </p>

          <o-field>
            <o-timepicker
              v-model="startTime"
              inline
              size="small"
              icon="clock"
              hour-format="24"
              :disabled="!stopDepartureLoadingComplete || selectedTimeOfDayMode !== 'Partial'"
            />
          </o-field>

          <p class="menu-label">
            Ending
          </p>

          <o-field>
            <o-timepicker
              v-model="endTime"
              inline
              size="small"
              icon="clock"
              hour-format="24"
              :disabled="!stopDepartureLoadingComplete || selectedTimeOfDayMode !== 'Partial'"
            />
          </o-field>
        </aside>
      </div>

      <!-- SERVICE LEVELS -->
      <div v-if="activeTab === 'service-levels'">
        <aside class="cal-service-levels menu">
          <p class="menu-label">
            Frequency
          </p>

          <o-field grouped>
            <o-checkbox
              v-model="frequencyUnderEnabled"
              label="Avg. Frequency ≦"
              :disabled="!stopDepartureLoadingComplete"
            />
            <div class="cal-input-width-80">
              <o-input
                v-model="frequencyUnder"
                number
                type="number"
                min="0"
                :disabled="!stopDepartureLoadingComplete || !frequencyUnderEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </o-field>

          <o-field grouped>
            <o-checkbox
              v-model="frequencyOverEnabled"
              label="Avg. Frequency >"
              :disabled="!stopDepartureLoadingComplete"
            />
            <div class="cal-input-width-80">
              <o-input
                v-model="frequencyOver"
                number
                type="number"
                min="0"
                :disabled="!stopDepartureLoadingComplete || !frequencyOverEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </o-field>

          <o-field>
            <o-checkbox
              v-model="calculateFrequencyMode"
              label="Calculate frequency based on single routes"
              :disabled="true"
            />
          </o-field>

          <p class="menu-label">
            Fares <o-tooltip label="Fare filtering is planned for future implementation" multiline>
              <i class="mdi mdi-information-outline" />
            </o-tooltip>
          </p>

          <o-field grouped>
            <o-checkbox
              v-model="maxFareEnabled"
              label="Maximum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <o-input
                v-model="maxFare"
                number
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </o-field>

          <o-field grouped>
            <o-checkbox
              v-model="minFareEnabled"
              label="Minimum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <o-input
                v-model="minFare"
                number
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </o-field>
        </aside>
      </div>

      <!-- LAYERS -->
      <div v-if="activeTab === 'transit-layers'">
        <aside class="menu">
          <p class="menu-label">
            Modes
          </p>
          <ul>
            <li v-for="[routeType, routeTypeDesc] of routeTypes" :key="routeType">
              <o-checkbox v-model="selectedRouteTypes" :native-value="routeType">
                {{ routeTypeDesc }}
              </o-checkbox>
            </li>
          </ul>
          <p class="filter-legend">
            * Stops served by any of the selected route types
          </p>

          <p class="menu-label">
            Agencies
          </p>

          <p class="menu-label">
            <o-field grouped>
              <o-input
                v-model="agencySearch"
                type="Search"
                placeholder="search"
                icon-right="magnify"
                icon-right-clickable
              />
              <o-field addons>
                <o-button @click="agencySelectNone">
                  None
                </o-button>
                <o-button @click="agencySelectAll">
                  All
                </o-button>
              </o-field>
            </o-field>
          </p>

          <ul>
            <li v-for="agencyName of knownAgencies" :key="agencyName">
              <o-checkbox v-model="selectedAgencies" :native-value="agencyName">
                {{ agencyName }}
              </o-checkbox>
            </li>
          </ul>
          <p class="filter-legend">
            * Stops served by any of the selected agencies
          </p>
        </aside>
      </div>

      <!-- DATA DISPLAY -->
      <div v-if="activeTab === 'data-display'">
        <aside class="menu">
          <p class="menu-label">
            Show data by:
          </p>
          <ul>
            <li v-for="dataDisplayModeOption of dataDisplayModes" :key="dataDisplayModeOption">
              <o-radio v-model="dataDisplayMode" :native-value="dataDisplayModeOption">
                {{ dataDisplayModeOption }}
              </o-radio>
            </li>
          </ul>

          <p class="menu-label">
            Display map elements by:
          </p>
          <ul>
            <li>
              <o-radio v-model="colorKey" native-value="Mode" :disabled="dataDisplayMode === 'Agency'">
                Mode
              </o-radio>
            </li>
            <li>
              <o-radio v-model="colorKey" native-value="Frequency" :disabled="dataDisplayMode === 'Agency'">
                Frequency
              </o-radio>
            </li>
            <li>
              <o-radio v-model="colorKey" native-value="Fare" :disabled="true /* this is future functionality */">
                Fare <o-tooltip label="This is planned for future implementation" multiline>
                  <i class="mdi mdi-information-outline" />
                </o-tooltip>
              </o-radio>
            </li>
          </ul>
          <p class="menu-label">
            Base map <o-tooltip label="Switch the reference map displayed underneath transit route and stop features. Currently only an OpenStreetMap base map is available. Aerial imagery may be added in the future" multiline>
              <i class="mdi mdi-information-outline" />
            </o-tooltip>
          </p>
          <ul>
            <li v-for="baseMapStyle of baseMapStyles" :key="baseMapStyle.name">
              <o-radio v-model="baseMap" :native-value="baseMapStyle.name" :disabled="!baseMapStyle.available">
                <o-icon :icon="baseMapStyle.icon" size="medium" /> {{ baseMapStyle.name }}
              </o-radio>
            </li>
          </ul>
        </aside>
      </div>

      <!-- SETTINGS -->
      <div v-if="activeTab === 'settings'">
        <aside class="menu">
          <p class="menu-label">
            Units of measurement
          </p>
          <ul>
            <li>
              <o-radio v-model="unitSystem" native-value="us">
                🇺🇸 USA
              </o-radio>
            </li>
            <li>
              <o-radio v-model="unitSystem" native-value="eu">
                🇪🇺 Metric
              </o-radio>
            </li>
          </ul>

          <p class="menu-label">
            Display options
          </p>
          <ul>
            <li>
              <o-field grouped>
                <o-checkbox
                  v-model="hideUnmarked"
                  label="Hide unmarked routes/stops"
                />
              </o-field>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { eachDayOfInterval } from 'date-fns'
import { defineEmits } from 'vue'
import type { Stop } from '~/src/stop'
import { type dow, dowValues, routeTypes, dataDisplayModes, baseMapStyles } from '~/src/constants'
</script>

<script setup lang="ts">
import { fmtDate } from '~/src/datetime'

const menuItems = [
  { icon: 'calendar-blank', label: 'Timeframes', tab: 'timeframes' },
  { icon: 'chart-bar', label: 'Service Levels', tab: 'service-levels' },
  { icon: 'bus', label: 'Transit Layers', tab: 'transit-layers' },
  { icon: 'layers-outline', label: 'Data Display', tab: 'data-display' },
  { icon: 'cog', label: 'Settings', tab: 'settings' },
]

const props = defineProps<{
  stopFeatures: Stop[]
  stopDepartureLoadingComplete: boolean
}>()

const emit = defineEmits([
  'resetFilters'
])

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const startTime = defineModel<Date | null>('startTime')
const endTime = defineModel<Date | null>('endTime')
const unitSystem = defineModel<string>('unitSystem')
const hideUnmarked = defineModel<boolean>('hideUnmarked')
const colorKey = defineModel<string>('colorKey')
const dataDisplayMode = defineModel<string>('dataDisplayMode')
const baseMap = defineModel<string>('baseMap')
const selectedDayOfWeekMode = defineModel<string>('selectedDayOfWeekMode')
const selectedTimeOfDayMode = defineModel<string>('selectedTimeOfDayMode')
const selectedRouteTypes = defineModel<number[]>('selectedRouteTypes')
const selectedDays = defineModel<dow[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')
const frequencyUnderEnabled = defineModel<boolean>('frequencyUnderEnabled')
const frequencyUnder = defineModel<number>('frequencyUnder')
const frequencyOverEnabled = defineModel<boolean>('frequencyOverEnabled')
const frequencyOver = defineModel<number>('frequencyOver')
const calculateFrequencyMode = defineModel<boolean>('calculateFrequencyMode')
const maxFareEnabled = defineModel<boolean>('maxFareEnabled')
const maxFare = defineModel<number>('maxFare')
const minFareEnabled = defineModel<boolean>('minFareEnabled')
const minFare = defineModel<number>('minFare')
const activeTab = defineModel<string>('activeTab')

///////////////////
// Tab

function setTab (v: string) {
  if (activeTab.value === v) {
    activeTab.value = ''
    return
  }
  activeTab.value = v
}

///////////////////
// Agency selector

const agencySearch = ref('')

function agencySelectNone () {
  agencySearch.value = ''
  selectedAgencies.value = []
}

function agencySelectAll () {
  agencySearch.value = ''
  selectedAgencies.value = knownAgencies.value
}

const knownAgencies = computed(() => {
  const agencies = new Set<string>()
  for (const feature of props.stopFeatures) {
    for (const rs of feature.route_stops) {
      agencies.add(rs.route.agency.agency_name)
    }
  }
  const sv = agencySearch.value.toLowerCase()
  if (sv) {
    return Array.from(agencies).filter(a => a.toLowerCase().includes(sv))
  }
  return Array.from(agencies).toSorted((a, b) => a.localeCompare(b))
})

const dowAvailable = computed((): Set<string> => {
  // JavaScript day of week starts on Sunday, this is different from dowValues
  const jsDowValues: dow[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const result = new Set<string>()
  const range = eachDayOfInterval({ start: startDate.value, end: endDate.value })
  for (const d of range) {
    result.add(jsDowValues[d.getDay()])
    if (result.size === 7) break // we got them all
  }
  return result
})
</script>

<style scoped lang="scss">
.cal-filter {
  display:flex;
  flex-direction:green;
  background: var(--bulma-scheme-main);
  margin:0px;
  height:100%;
  padding-left:20px;
  .cal-filter-main {
    display:flex;
    flex-direction: column;
    .menu {
      flex-grow:1;
      width:250px;
    }
  }
  .cal-filter-sub {
    display:flex;
    width:400px;
    flex-direction: column;
    background: var(--bulma-scheme-main-ter);
    margin:0px;
    padding-left:20px;
    /* removed overflow styling so we don't cut off tooltips */
  }
}

.cal-day-of-week-mode {
  margin-left:20px;
  margin-bottom:15px;

  > div {
    margin-bottom: unset;
  }
}

.cal-service-levels {
  .is-grouped div {
    display: flex;
    align-items: center;
  }
  .is-grouped .checkbox {
    width: 185px;
  }
  .cal-input-width-80 {
    max-width: 80px;
    border: 1px solid #ccc;
    border-radius: 5px;
  }
  .cal-input-width-100 {
    max-width: 100px;
    border: 1px solid #ccc;
    border-radius: 5px;
  }
}

.menu-list {
  a.is-active {
    color:var(--bulma-text-main-ter);
    background:var(--bulma-scheme-main-ter);
  }
  .right-chev {
    float:right;
  }
}
.filter-legend {
  font-size:10pt;
  margin-top:10px;
  margin-bottom:40px;
}
</style>
