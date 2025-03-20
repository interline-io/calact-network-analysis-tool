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
          <li v-for="item of menuItems" :key="item.panel">
            <a :class="{ 'is-active': activePanel === item.panel }" @click="setPanel(item.panel)">
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

    <div v-if="activePanel" class="cal-filter-sub">
      <div>
        <o-icon
          icon="chevron-left"
          class="is-pulled-right"
          size="large"
          @click="setPanel('')"
        />
      </div>

      <!-- TIMEFRAMES -->
      <div v-if="activePanel === 'timeframes'">
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
              <o-checkbox v-model="selectedDays" :native-value="dowValue" :disabled="!stopDepartureLoadingComplete">
                {{ dowValue }}
              </o-checkbox>
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
              hour-format="12"
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
              hour-format="12"
              :disabled="!stopDepartureLoadingComplete || selectedTimeOfDayMode !== 'Partial'"
            />
          </o-field>
        </aside>
      </div>

      <!-- LAYERS -->
      <div v-if="activePanel === 'transit-layers'">
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

      <!-- MAP DISPLAY -->
      <div v-if="activePanel === 'map'">
        <aside class="menu">
          <p class="menu-label">
            Color routes by:
          </p>
          <ul>
            <li v-for="routeColorMode of routeColorModes" :key="routeColorMode">
              <o-radio v-model="colorKey" :native-value="routeColorMode" disabled>
                {{ routeColorMode }}
              </o-radio>
            </li>
          </ul>
          <p class="filter-legend">
            * Not yet implemented
          </p>
          <p class="menu-label">
            Base map
          </p>
          <ul>
            <li v-for="baseMapStyle of baseMapStyles" :key="baseMapStyle">
              <o-radio v-model="baseMap" :native-value="baseMapStyle">
                <o-icon icon="map-search" size="large" /> {{ baseMapStyle }}
              </o-radio>
            </li>
          </ul>
        </aside>
      </div>

      <!-- SETTINGS -->
      <div v-if="activePanel === 'settings'">
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
        </aside>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { routeTypes, dowValues, routeColorModes, baseMapStyles } from '../constants'
</script>

<script setup lang="ts">
import { fmtDate } from '../datetime'
import { defineEmits } from 'vue'
import { type Stop } from './scenario.vue'

const menuItems = [
  { icon: 'chart-bar', label: 'Timeframes', panel: 'timeframes' },
  { icon: 'bus', label: 'Transit Layers', panel: 'transit-layers' },
  { icon: 'layers-outline', label: 'Map Display', panel: 'map' },
  { icon: 'cog', label: 'Settings', panel: 'settings' },
]

const props = defineProps<{
  stopFeatures: Stop[]
}>()

const emit = defineEmits([
  'resetFilters'
])

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const startTime = defineModel<Date | null>('startTime')
const endTime = defineModel<Date | null>('endTime')
const unitSystem = defineModel<string>('unitSystem')
const colorKey = defineModel<string>('colorKey')
const baseMap = defineModel<string>('baseMap')
const selectedDayOfWeekMode = defineModel<string>('selectedDayOfWeekMode')
const selectedTimeOfDayMode = defineModel<string>('selectedTimeOfDayMode')
const selectedRouteTypes = defineModel<string[]>('selectedRouteTypes')
const selectedDays = defineModel<string[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')
const stopDepartureLoadingComplete = defineModel<boolean>('stopDepartureLoadingComplete')

///////////////////
// Panel

const activePanel = ref('')
function setPanel (v: string) {
  if (activePanel.value === v) {
    activePanel.value = ''
    return
  }
  activePanel.value = v
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
    overflow-y:auto;
    overflow-x:clip;
  }
}

.cal-day-of-week-mode {
  margin-left:20px;
  margin-bottom:15px;

  > div {
    margin-bottom: unset;
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
