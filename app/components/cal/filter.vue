<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <tl-title title="Filters" />

      <aside class="menu">
        <p class="menu-label">
          Filters
        </p>
        <o-button
          class="mx-4 mb-4"
          icon-left="delete"
          @click="emit('resetFilters')"
        >
          Clear all
        </o-button>
        <ul class="menu-list">
          <li
            v-for="item of menuItems"
            :key="item.tab"
          >
            <a
              :class="{ 'is-active': activeTab === item.tab }"
              @click="setTab(item.tab)"
            >
              <o-icon
                :icon="item.icon"
                class="is-fullwidth"
              />
              {{ item.label }}
              <span
                v-if="item.tab === 'transit-layers' && hasFixedRouteData"
                class="data-indicator has-background-info"
                title="Fixed-route data loaded and available for filtering"
              />
              <span
                v-if="item.tab === 'flex-services' && hasFlexData"
                class="data-indicator has-background-info"
                title="Flex service data loaded and available for filtering"
              />
              <o-icon
                class="right-chev"
                icon="chevron-right"
                size="small"
              />
            </a>
          </li>
        </ul>
      </aside>

      <div class="cal-filter-summary">
        <p>
          Showing data for:<br>
          {{ fmtDate(startDate) }}
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

    <div
      v-if="activeTab"
      class="cal-filter-sub"
    >
      <div class="is-flex is-justify-content-flex-end mb-4">
        <button
          type="button"
          class="button is-text"
          aria-label="Close filter panel"
          title="Close filter panel"
          @click="setTab('')"
        >
          <o-icon
            icon="chevron-left"
            size="large"
            aria-hidden="true"
          />
        </button>
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
              />
            </o-field>
            <o-field>
              <o-radio
                v-model="selectedDayOfWeekMode"
                name="selectedDayOfWeekMode"
                native-value="All"
                label="All of the following days"
              />
            </o-field>
          </section>

          <ul>
            <li
              v-for="dowValue of dowValues"
              :key="dowValue"
            >
              <o-checkbox
                v-model="selectedDays"
                :native-value="dowValue"
                :label="dowValue"
                :disabled="!dowAvailable.has(dowValue)"
              />
            </li>
          </ul>
        </aside>

        <aside class="cal-filter-times menu block">
          <p class="menu-label">
            Time of Day
            <o-tooltip
              label="Fixed-route transit: Filters to show only departures within the selected time window. Flex service areas: Filters to show only areas with service windows that overlap with the selected time range."
              multiline
              size="small"
              position="left"
            >
              <i class="mdi mdi-information-outline" />
            </o-tooltip>
          </p>

          <o-field class="cal-time-of-day-mode">
            <o-checkbox
              v-model="selectedTimeOfDayMode"
              label="All Day"
              true-value="All"
              false-value="Partial"
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
              :disabled="selectedTimeOfDayMode !== 'Partial'"
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
              :disabled="selectedTimeOfDayMode !== 'Partial'"
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
            />
            <div class="cal-input-width-80">
              <o-input
                v-model="frequencyUnder"
                number
                type="number"
                min="0"
                :disabled="!frequencyUnderEnabled"
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
            />
            <div class="cal-input-width-80">
              <o-input
                v-model="frequencyOver"
                number
                type="number"
                min="0"
                :disabled="!frequencyOverEnabled"
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
            Fares <o-tooltip
              label="Fare filtering is planned for future implementation"
              multiline
            >
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
          <o-field class="cal-fixed-route-toggle">
            <o-checkbox
              v-model="fixedRouteEnabled"
              label="Include Fixed-Route Transit"
            />
            <o-tooltip
              label="Show fixed-route transit services (buses, trains, ferries) with scheduled stops and routes. Turn off to focus only on flex/demand-responsive services."
              multiline
            >
              <i class="mdi mdi-help-circle-outline" />
            </o-tooltip>
          </o-field>

          <div
            class="cal-fixed-route-options"
            :class="{ 'is-disabled': !fixedRouteEnabled }"
          >
            <p class="menu-label">
              Modes
            </p>
            <ul>
              <li
                v-for="[routeType, routeTypeDesc] of routeTypeNames"
                :key="routeType"
              >
                <o-checkbox
                  v-model="selectedRouteTypes"
                  :native-value="routeType"
                  :disabled="!fixedRouteEnabled"
                >
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

            <div class="cal-agency-search">
              <o-field>
                <o-input
                  v-model="agencySearch"
                  type="Search"
                  placeholder="search"
                  icon-right="magnify"
                  icon-right-clickable
                  :disabled="!fixedRouteEnabled"
                />
              </o-field>
              <o-field
                grouped
                class="cal-agency-buttons"
              >
                <o-button
                  size="small"
                  :disabled="!fixedRouteEnabled"
                  @click="agencySelectNone"
                >
                  None
                </o-button>
                <o-button
                  size="small"
                  :disabled="!fixedRouteEnabled"
                  @click="agencySelectAll"
                >
                  All
                </o-button>
              </o-field>
            </div>

            <ul>
              <li
                v-for="agencyName of knownAgencies"
                :key="agencyName"
              >
                <o-checkbox
                  v-model="selectedAgencies"
                  :native-value="agencyName"
                  :disabled="!fixedRouteEnabled"
                >
                  {{ agencyName }}
                </o-checkbox>
              </li>
            </ul>
            <p class="filter-legend">
              * Stops served by any of the selected agencies
            </p>
          </div>
        </aside>
      </div>

      <!-- FLEX SERVICES (DRT/Demand-Responsive Transit) -->
      <div v-if="activeTab === 'flex-services'">
        <aside class="menu">
          <o-field class="cal-flex-toggle">
            <o-checkbox
              v-model="flexServicesEnabled"
              label="Include Flex Services"
            />
            <o-tooltip
              label="Flex services are demand-responsive transit (DRT) that operate within defined areas rather than fixed routes. Data comes from GTFS-Flex extension feeds."
              multiline
            >
              <i class="mdi mdi-help-circle-outline" />
            </o-tooltip>
          </o-field>

          <div
            v-if="flexServicesEnabled"
            class="cal-flex-warning"
          >
            <o-icon icon="alert" size="small" />
            <span>
              Flex service data may be incomplete. Please contact relevant agencies for additional information.
            </span>
          </div>

          <div
            class="cal-flex-options"
            :class="{ 'is-disabled': !flexServicesEnabled }"
          >
            <p class="menu-label">
              Advance notice
            </p>
            <ul>
              <li
                v-for="noticeType of flexAdvanceNoticeTypes"
                :key="noticeType"
              >
                <o-checkbox
                  v-model="flexAdvanceNotice"
                  :native-value="noticeType"
                  :disabled="!flexServicesEnabled"
                >
                  {{ noticeType }}
                </o-checkbox>
              </li>
            </ul>

            <p class="menu-label">
              Show areas that allow:
            </p>
            <ul>
              <li
                v-for="areaType of flexAreaTypes"
                :key="areaType"
              >
                <o-checkbox
                  v-model="flexAreaTypesSelected"
                  :native-value="areaType"
                  :disabled="!flexServicesEnabled"
                >
                  {{ areaType }}
                </o-checkbox>
              </li>
            </ul>

            <p class="menu-label">
              Color by:
            </p>
            <ul>
              <li
                v-for="colorMode of flexColorByModes"
                :key="colorMode"
              >
                <o-radio
                  v-model="flexColorBy"
                  :native-value="colorMode"
                  :disabled="!flexServicesEnabled"
                >
                  {{ colorMode }}
                </o-radio>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <!-- DATA DISPLAY -->
      <div v-if="activeTab === 'data-display'">
        <aside class="menu">
          <ul>
            <li
              v-for="dataDisplayModeOption of dataDisplayModes"
              :key="dataDisplayModeOption"
            >
              <o-radio
                v-model="dataDisplayMode"
                :native-value="dataDisplayModeOption"
              >
                {{ dataDisplayModeOption }}
              </o-radio>
            </li>
          </ul>
          <p class="menu-label">
            Display map elements by:
          </p>
          <ul>
            <li>
              <o-radio
                v-model="colorKey"
                native-value="Mode"
                :disabled="dataDisplayMode === 'Agency'"
              >
                Mode
              </o-radio>
            </li>
            <li>
              <o-radio
                v-model="colorKey"
                native-value="Frequency"
                :disabled="dataDisplayMode === 'Agency'"
              >
                Frequency
              </o-radio>
            </li>
            <li>
              <o-radio
                v-model="colorKey"
                native-value="Fare"
                :disabled="true /* this is future functionality */"
              >
                Fare <o-tooltip
                  label="This is planned for future implementation"
                  multiline
                >
                  <i class="mdi mdi-information-outline" />
                </o-tooltip>
              </o-radio>
            </li>
          </ul>
          <p class="menu-label">
            Base map <o-tooltip
              label="Switch the reference map displayed underneath transit route and stop features. Currently only an OpenStreetMap base map is available. Aerial imagery may be added in the future"
              multiline
            >
              <i class="mdi mdi-information-outline" />
            </o-tooltip>
          </p>
          <ul>
            <li
              v-for="baseMapStyle of baseMapStyles"
              :key="baseMapStyle.name"
            >
              <o-radio
                v-model="baseMap"
                :native-value="baseMapStyle.name"
                :disabled="!baseMapStyle.available"
              >
                <span class="cal-radio-with-icon">
                  <o-icon
                    :icon="baseMapStyle.icon"
                    size="small"
                  /> {{ baseMapStyle.name }}
                </span>
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
              <o-radio
                v-model="unitSystem"
                native-value="us"
              >
                🇺🇸 USA
              </o-radio>
            </li>
            <li>
              <o-radio
                v-model="unitSystem"
                native-value="eu"
              >
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
import { type dow, dowValues, routeTypeNames, dataDisplayModes, baseMapStyles, flexAdvanceNoticeTypes, flexAreaTypes, flexColorByModes } from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'
</script>

<script setup lang="ts">
import { fmtDate } from '~~/src/core'

const menuItems = [
  { icon: 'calendar-blank', label: 'Timeframes', tab: 'timeframes' },
  { icon: 'chart-bar', label: 'Service Levels', tab: 'service-levels' },
  { icon: 'bus', label: 'Transit Services', tab: 'transit-layers' },
  { icon: 'bus-marker', label: 'Flex Services', tab: 'flex-services' },
  { icon: 'layers-outline', label: 'Map Display', tab: 'data-display' },
  { icon: 'cog', label: 'Settings', tab: 'settings' },
]

const props = defineProps<{
  scenarioFilterResult?: ScenarioFilterResult
  hasFixedRouteData?: boolean
  hasFlexData?: boolean
}>()

const emit = defineEmits([
  'resetFilters',
])
const activeTab = defineModel<string>('activeTab')

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

// Fixed-Route Transit toggle
const fixedRouteEnabled = defineModel<boolean>('fixedRouteEnabled') // On by default

// Flex Services (DRT) filter models
const flexServicesEnabled = defineModel<boolean>('flexServicesEnabled') // Off by default
const flexAdvanceNotice = defineModel<string[]>('flexAdvanceNotice') // All selected by default when enabled
const flexAreaTypesSelected = defineModel<string[]>('flexAreaTypesSelected') // All selected by default when enabled
const flexColorBy = defineModel<string>('flexColorBy') // 'Agency' by default

// Data availability indicators
const hasFixedRouteData = computed(() => props.hasFixedRouteData ?? false)
const hasFlexData = computed(() => props.hasFlexData ?? false)

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
  for (const feature of props.scenarioFilterResult?.stops || []) {
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
  if (!startDate.value || !endDate.value) {
    return result
  }
  const range = eachDayOfInterval({ start: startDate.value, end: endDate.value })
  for (const d of range) {
    const dow = jsDowValues[d.getDay()]
    if (dow) {
      result.add(dow)
    }
    if (result.size === 7) break // we got them all
  }
  return result
})
</script>

<style scoped lang="scss">
.cal-filter {
  display:flex;
  flex-direction: row;
  background: var(--bulma-scheme-main);
  margin:0px;
  height:100%;
  padding-left:20px;
  min-width: 250px; /* Minimum width for main panel */
  .cal-filter-main {
    display:flex;
    flex-direction: column;
    flex-shrink: 0; /* Don't shrink main panel */
    .menu {
      flex-grow:1;
      width:250px;
    }
  }
  .cal-filter-sub {
    display:flex;
    width: 400px;
    min-width: 350px; /* Minimum reasonable width */
    flex-shrink: 0; /* Don't shrink sub-panel */
    flex-direction: column;
    background: var(--bulma-scheme-main-ter);
    margin:0px;
    padding-left:20px;
    padding-right:20px;
    overflow-x: hidden; /* Prevent horizontal overflow */
    overflow-y: visible; /* No vertical scrollbar */
    box-sizing: border-box; /* Include padding in width calculation */
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
  .data-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 6px;
    vertical-align: middle;
  }
}
.filter-legend {
  font-size:10pt;
  margin-top:10px;
  margin-bottom:40px;
}

.cal-agency-search {
  margin-bottom: 1rem;
  width: 100%;
  max-width: 100%;

  .o-field {
    width: 100%;
    max-width: 100%;

    .o-input {
      width: 100%;
      max-width: 100%;
    }
  }

  .cal-agency-buttons {
    margin-top: 0.5rem;
    flex-wrap: wrap;
    width: 100%;

    .o-button {
      flex: 1 1 auto;
      min-width: 0;
    }
  }
}

.cal-radio-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  white-space: normal;
  word-wrap: break-word;
  max-width: 100%;

  .o-icon {
    flex-shrink: 0;
  }
}

.cal-filter-sub {
  .button.is-text {
    &:hover {
      color: var(--bulma-primary);
    }
  }

  .menu {
    width: 100%;
    max-width: 100%;
    min-width: 0;

    .menu-label {
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    ul {
      width: 100%;
      min-width: 0;

      li {
        width: 100%;
        min-width: 0;

        .o-radio,
        .o-checkbox {
          width: 100%;
          min-width: 0;
          white-space: normal;
          word-wrap: break-word;

          .o-tooltip {
            display: inline-block;
            margin-left: 0.25rem;
          }
        }
      }
    }
  }
}

// Flex Services styles
// Shared toggle styles for fixed-route and flex services
.cal-fixed-route-toggle,
.cal-flex-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;

  .o-checkbox {
    margin-bottom: 0;
  }

  .mdi-help-circle-outline {
    color: var(--bulma-text-weak);
    cursor: help;

    &:hover {
      color: var(--bulma-primary);
    }
  }
}

.cal-fixed-route-options {
  transition: opacity 0.2s ease;

  &.is-disabled {
    opacity: 0.5;
    pointer-events: none;
  }
}

.cal-flex-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 1rem;
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  color: #856404;
  font-size: 0.85rem;
  line-height: 1.4;

  .o-icon {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
}

.cal-flex-options {
  transition: opacity 0.2s ease;

  &.is-disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .menu-label {
    margin-top: 1rem;

    &:first-child {
      margin-top: 0;
    }
  }

  ul {
    margin-left: 0.5rem;

    li {
      margin-bottom: 0.25rem;
    }
  }
}
</style>
