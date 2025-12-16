<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <tl-title title="Filters" />

      <aside class="menu">
        <p class="menu-label">
          Filters
        </p>
        <t-button
          class="mx-4 mb-4"
          icon-left="delete"
          @click="emit('resetFilters')"
        >
          Clear all
        </t-button>
        <ul class="menu-list">
          <li
            v-for="item of menuItems"
            :key="item.tab"
          >
            <a
              :class="{ 'is-active': activeTab === item.tab }"
              @click="setTab(item.tab)"
            >
              <t-icon
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
              <t-icon
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
          <t-button>bounding box</t-button>
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
          <t-icon
            icon="chevron-left"
            size="large"
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
            <t-field>
              <t-radio
                v-model="selectedWeekdayMode"
                name="selectedWeekdayMode"
                native-value="Any"
                label="Any of the following days"
              />
            </t-field>
            <t-field>
              <t-radio
                v-model="selectedWeekdayMode"
                name="selectedWeekdayMode"
                native-value="All"
                label="All of the following days"
              />
            </t-field>
          </section>
          <t-checkbox-group
            v-model="selectedWeekdays"
            :options="dowValues.map(d => ({ value: d, label: d, disabled: !dowAvailable.has(d) }))"
          />
        </aside>

        <aside class="cal-filter-times menu block">
          <p class="menu-label">
            Time of Day
            <t-tooltip
              text="Fixed-route transit: Filters to show only departures within the selected time window. Flex service areas: Filters to show only areas with service windows that overlap with the selected time range."
              position="left"
            >
              <i class="mdi mdi-information-outline" />
            </t-tooltip>
          </p>

          <t-field class="cal-time-of-day-mode">
            <t-checkbox
              v-model="isAllDayMode"
              label="All Day"
            />
          </t-field>

          <p class="menu-label">
            Starting
          </p>

          <t-field>
            <cal-timepicker
              v-model="startTime"
              size="small"
              icon="clock"
              :disabled="isAllDayMode"
            />
          </t-field>

          <p class="menu-label">
            Ending
          </p>

          <t-field>
            <cal-timepicker
              v-model="endTime"
              size="small"
              icon="clock"
              :disabled="isAllDayMode"
            />
          </t-field>
        </aside>
      </div>

      <!-- SERVICE LEVELS -->
      <div v-if="activeTab === 'service-levels'">
        <aside class="cal-service-levels menu">
          <p class="menu-label">
            Frequency
          </p>

          <t-field grouped>
            <t-checkbox
              v-model="frequencyUnderEnabled"
              label="Avg. Frequency ≦"
            />
            <div class="cal-input-width-80">
              <t-input
                v-model="frequencyUnder"
                type="number"
                min="0"
                :disabled="!frequencyUnderEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </t-field>

          <t-field grouped>
            <t-checkbox
              v-model="frequencyOverEnabled"
              label="Avg. Frequency >"
            />
            <div class="cal-input-width-80">
              <t-input
                v-model="frequencyOver"
                type="number"
                min="0"
                :disabled="!frequencyOverEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </t-field>

          <t-field>
            <t-checkbox
              v-model="calculateFrequencyMode"
              label="Calculate frequency based on single routes"
              :disabled="true"
            />
          </t-field>

          <p class="menu-label">
            Fares <t-tooltip text="Fare filtering is planned for future implementation">
              <i class="mdi mdi-information-outline" />
            </t-tooltip>
          </p>

          <t-field grouped>
            <t-checkbox
              v-model="maxFareEnabled"
              label="Maximum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <t-input
                v-model="maxFare"
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </t-field>

          <t-field grouped>
            <t-checkbox
              v-model="minFareEnabled"
              label="Minimum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <t-input
                v-model="minFare"
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </t-field>
        </aside>
      </div>

      <!-- LAYERS -->
      <div v-if="activeTab === 'transit-layers'">
        <aside class="menu">
          <t-field grouped class="mb-4">
            <t-checkbox
              v-model="fixedRouteEnabled"
              label="Include Fixed-Route Transit"
            />
            <t-tooltip text="Show fixed-route transit services (buses, trains, ferries) with scheduled stops and routes. Turn off to focus only on flex/demand-responsive services.">
              <i class="mdi mdi-help-circle-outline" />
            </t-tooltip>
          </t-field>

          <div :class="{ 'is-disabled': !fixedRouteEnabled }">
            <p class="menu-label">
              Modes
            </p>
            <t-checkbox-group
              v-model="selectedRouteTypes"
              :options="[...routeTypeNames].map(([routeType, routeTypeDesc]) => ({ value: routeType, label: routeTypeDesc, disabled: !fixedRouteEnabled }))"
            />
            <p class="filter-legend">
              * Stops served by any of the selected route types
            </p>

            <p class="menu-label">
              Agencies
            </p>

            <div class="cal-agency-search">
              <t-field>
                <t-input
                  v-model="agencySearch"
                  type="search"
                  placeholder="search"
                  icon-right="magnify"
                  icon-right-clickable
                  :disabled="!fixedRouteEnabled"
                />
              </t-field>
            </div>

            <t-checkbox-group
              v-model="selectedAgencies"
              :options="knownAgencies.map(a => ({ value: a, label: a, disabled: !fixedRouteEnabled }))"
            />
            <p class="filter-legend">
              * Stops served by any of the selected agencies
            </p>
          </div>
        </aside>
      </div>

      <!-- FLEX SERVICES (DRT/Demand-Responsive Transit) -->
      <div v-if="activeTab === 'flex-services'">
        <aside class="menu">
          <t-field grouped class="mb-4">
            <t-checkbox
              v-model="flexServicesEnabled"
              label="Include Flex Services"
            />
            <t-tooltip text="Flex services are demand-responsive transit (DRT) that operate within defined areas rather than fixed routes. Data comes from GTFS-Flex extension feeds.">
              <i class="mdi mdi-help-circle-outline" />
            </t-tooltip>
          </t-field>

          <t-notification
            v-if="flexServicesEnabled"
            variant="warning"
          >
            <span>
              Flex service data may be incomplete. Please contact relevant agencies for additional information.
            </span>
          </t-notification>

          <div :class="{ 'is-disabled': !flexServicesEnabled }">
            <p class="menu-label">
              Advance notice
            </p>
            <ul>
              <li
                v-for="noticeType of flexAdvanceNoticeTypes"
                :key="noticeType"
              >
                <t-checkbox
                  v-model="flexAdvanceNotice"
                  :native-value="noticeType"
                  :disabled="!flexServicesEnabled"
                >
                  {{ noticeType }}
                </t-checkbox>
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
                <t-checkbox
                  v-model="flexAreaTypesSelected"
                  :native-value="areaType"
                  :disabled="!flexServicesEnabled"
                >
                  {{ areaType }}
                </t-checkbox>
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
                <t-radio
                  v-model="flexColorBy"
                  :native-value="colorMode"
                  :disabled="!flexServicesEnabled"
                >
                  {{ colorMode }}
                </t-radio>
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
              <t-radio
                v-model="dataDisplayMode"
                :native-value="dataDisplayModeOption"
              >
                {{ dataDisplayModeOption }}
              </t-radio>
            </li>
          </ul>
          <p class="menu-label">
            Display map elements by:
          </p>
          <ul>
            <li>
              <t-radio
                v-model="colorKey"
                native-value="Mode"
                :disabled="dataDisplayMode === 'Agency'"
              >
                Mode
              </t-radio>
            </li>
            <li>
              <t-radio
                v-model="colorKey"
                native-value="Frequency"
                :disabled="dataDisplayMode === 'Agency'"
              >
                Frequency
              </t-radio>
            </li>
            <li>
              <t-radio
                v-model="colorKey"
                native-value="Fare"
                :disabled="true /* this is future functionality */"
              >
                Fare <t-tooltip text="This is planned for future implementation">
                  <i class="mdi mdi-information-outline" />
                </t-tooltip>
              </t-radio>
            </li>
          </ul>
          <p class="menu-label">
            Base map <t-tooltip text="Switch the reference map displayed underneath transit route and stop features. Currently only an OpenStreetMap base map is available. Aerial imagery may be added in the future">
              <i class="mdi mdi-information-outline" />
            </t-tooltip>
          </p>
          <ul>
            <li
              v-for="baseMapStyle of baseMapStyles"
              :key="baseMapStyle.name"
            >
              <t-radio
                v-model="baseMap"
                :native-value="baseMapStyle.name"
                :disabled="!baseMapStyle.available"
              >
                <span class="cal-radio-with-icon">
                  <t-icon
                    :icon="baseMapStyle.icon"
                    size="small"
                  /> {{ baseMapStyle.name }}
                </span>
              </t-radio>
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
              <t-radio
                v-model="unitSystem"
                native-value="us"
              >
                🇺🇸 USA
              </t-radio>
            </li>
            <li>
              <t-radio
                v-model="unitSystem"
                native-value="eu"
              >
                🇪🇺 Metric
              </t-radio>
            </li>
          </ul>

          <p class="menu-label">
            Display options
          </p>
          <ul>
            <li>
              <t-field grouped>
                <t-checkbox
                  v-model="hideUnmarked"
                  label="Hide unmarked routes/stops"
                />
              </t-field>
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
import {
  type WeekdayMode,
  type Weekday,
  type DataDisplayMode,
  type RouteType,
  dowValues,
  routeTypeNames,
  dataDisplayModes,
  baseMapStyles,
  flexAdvanceNoticeTypes,
  flexAreaTypes,
  flexColorByModes,
  fmtDate,
  parseTime
} from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'
</script>

<script setup lang="ts">
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
const startTime = defineModel<Date>('startTime')
const endTime = defineModel<Date>('endTime')
const unitSystem = defineModel<string>('unitSystem')
const hideUnmarked = defineModel<boolean>('hideUnmarked')
const colorKey = defineModel<string>('colorKey')
const dataDisplayMode = defineModel<DataDisplayMode>('dataDisplayMode')
const baseMap = defineModel<string>('baseMap')
const selectedWeekdayMode = defineModel<WeekdayMode>('selectedWeekdayMode')
const selectedRouteTypes = defineModel<RouteType[]>('selectedRouteTypes')
const selectedWeekdays = defineModel<Weekday[]>('selectedWeekdays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')
const frequencyUnder = defineModel<number>('frequencyUnder')
const frequencyOver = defineModel<number>('frequencyOver')

// Derived checkbox state: checked when value is defined, unchecked sets to undefined
const frequencyUnderEnabled = computed({
  get: () => frequencyUnder.value != null,
  set: (checked: boolean) => { frequencyUnder.value = checked ? 15 : undefined }
})
const frequencyOverEnabled = computed({
  get: () => frequencyOver.value != null,
  set: (checked: boolean) => { frequencyOver.value = checked ? 15 : undefined }
})
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

// Derived checkbox state: checked (All Day) when both times are undefined, unchecked sets default times
const isAllDayMode = computed({
  get: () => startTime.value == null && endTime.value == null,
  set: (checked: boolean) => {
    if (checked) {
      startTime.value = undefined
      endTime.value = undefined
    } else {
      startTime.value = parseTime('00:00:00')
      endTime.value = parseTime('23:59:00')
    }
  }
})

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
  const jsDowValues: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
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
  display: flex;
  background: var(--bulma-scheme-main);
  height: 100%;
  padding-left: 20px;
}

.cal-filter-main {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;

  .menu {
    flex-grow: 1;
    width: 250px;
  }
}

.cal-filter-sub {
  width: 400px;
  flex-shrink: 0;
  background: var(--bulma-scheme-main-ter);
  padding: 0 20px;
}

.cal-day-of-week-mode {
  margin-left: 20px;
  margin-bottom: 15px;
}

.cal-service-levels {
  .cal-input-width-80 {
    max-width: 80px;
  }
  .cal-input-width-100 {
    max-width: 100px;
  }
}

.menu-list {
  a.is-active {
    color: var(--bulma-text-main-ter);
    background: var(--bulma-scheme-main-ter);
  }
  .right-chev {
    float: right;
  }
  .data-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 6px;
  }
}

.filter-legend {
  font-size: 10pt;
  margin-top: 10px;
  margin-bottom: 40px;
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
