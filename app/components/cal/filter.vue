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
              :class="{ 'is-active': activeTab === item.tab, 'is-disabled': isMenuItemDisabled(item) }"
              @click="!isMenuItemDisabled(item) && setTab(item.tab)"
            >
              <t-icon
                :icon="item.icon"
                class="is-fullwidth"
              />
              {{ item.label }}
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
            :options="dowValues.map(d => ({ value: d, label: titleCase(d), disabled: !dowAvailable.has(d) }))"
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

      <!-- FIXED-ROUTE SERVICES -->
      <div v-if="activeTab === 'transit-layers'">
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

      <!-- FLEX SERVICES (DRT/Demand-Responsive Transit) -->
      <div v-if="activeTab === 'flex-services'">
        <aside class="menu">
          <t-notification
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
            <t-checkbox-group
              v-model="flexAdvanceNotice"
              :options="flexAdvanceNoticeTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
            />

            <p class="menu-label">
              Show areas that allow:
            </p>
            <t-checkbox-group
              v-model="flexAreaTypesSelected"
              :options="flexAreaTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
            />

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

      <!-- MODES & AGENCIES -->
      <div v-if="activeTab === 'agencies'">
        <aside class="menu">
          <p class="menu-label">
            Service Types
          </p>

          <div class="service-type-checkboxes mb-4">
            <t-field>
              <t-checkbox
                v-model="fixedRouteEnabled"
              >
                <span class="mode-label">
                  <t-icon icon="train-car" size="small" />
                  Fixed-Route
                </span>
              </t-checkbox>
            </t-field>
            <t-field>
              <t-checkbox
                v-model="flexServicesEnabled"
              >
                <span class="mode-label">
                  <t-icon icon="van-utility" size="small" />
                  Flex
                </span>
              </t-checkbox>
            </t-field>
          </div>

          <template v-if="fixedRouteEnabled">
            <p class="menu-label">
              Fixed-Route Modes
            </p>

            <div class="mode-checkboxes mb-4">
              <t-field
                v-for="mode in fixedRouteModeOptions"
                :key="mode.value"
              >
                <t-checkbox
                  v-model="localSelectedRouteTypes"
                  :native-value="mode.value"
                >
                  <span class="mode-label">
                    <t-icon :icon="mode.icon" size="small" />
                    {{ mode.label }}
                  </span>
                </t-checkbox>
              </t-field>
            </div>
          </template>

          <p class="menu-label">
            Agencies
          </p>

          <t-field>
            <t-input
              v-model="agencySearch"
              type="search"
              placeholder="search"
              icon-right="magnify"
              icon-right-clickable
            />
          </t-field>
          <div class="buttons mb-4">
            <t-button
              size="small"
              :disabled="allAgenciesSelected"
              @click="selectAllAgencies"
            >
              Select All
            </t-button>
            <t-button
              size="small"
              :disabled="noAgenciesSelected"
              @click="selectNoAgencies"
            >
              Select None
            </t-button>
          </div>

          <p
            v-if="!fixedRouteEnabled || !flexServicesEnabled"
            class="filter-legend mb-3"
          >
            <em>Grayed-out agencies do not match selected service types</em>
          </p>

          <div class="agency-checkbox-list">
            <t-field
              v-for="agency in agencyFilterOptions"
              :key="agency.value"
              :class="{ 'agency-disabled': isAgencyDisabled(agency) }"
            >
              <t-checkbox
                v-model="localSelectedAgencies"
                :native-value="agency.value"
              >
                <span class="agency-label">
                  {{ agency.name }}
                  <t-tooltip
                    v-if="agency.hasFixedRoute"
                    text="Has fixed-route service"
                    position="right"
                  >
                    <t-icon
                      icon="train-car"
                      size="small"
                      class="agency-icon"
                    />
                  </t-tooltip>
                  <t-tooltip
                    v-if="agency.hasFlex"
                    text="Has flex service"
                    position="right"
                  >
                    <t-icon
                      icon="van-utility"
                      size="small"
                      class="agency-icon"
                    />
                  </t-tooltip>
                </span>
              </t-checkbox>
            </t-field>
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
  type AgencyFilterItem,
  dowValues,
  routeTypeNames,
  routeTypeIcons,
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
  { icon: 'domain', label: 'Modes & Agencies', tab: 'agencies' },
  { icon: 'bus', label: 'Fixed-Route Services', tab: 'transit-layers', requiresFixedRoute: true },
  { icon: 'bus-marker', label: 'Flex Services', tab: 'flex-services', requiresFlex: true },
  { icon: 'layers-outline', label: 'Map Display', tab: 'data-display' },
  { icon: 'cog', label: 'Settings', tab: 'settings' },
]

const props = defineProps<{
  scenarioFilterResult?: ScenarioFilterResult
  agencyFilterItems?: AgencyFilterItem[]
}>()

const emit = defineEmits([
  'resetFilters',
  'setTimeRange',
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
const selectedRouteTypes = defineModel<RouteType[] | undefined>('selectedRouteTypes')
const selectedWeekdays = defineModel<Weekday[] | undefined>('selectedWeekdays')
const selectedAgencies = defineModel<string[] | undefined>('selectedAgencies')
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
const fixedRouteEnabled = defineModel<boolean | undefined>('fixedRouteEnabled') // On by default

// Flex Services (DRT) filter models
const flexServicesEnabled = defineModel<boolean | undefined>('flexServicesEnabled') // Off by default
const flexAdvanceNotice = defineModel<string[] | undefined>('flexAdvanceNotice') // undefined = not set (default all), [] = none selected
const flexAreaTypesSelected = defineModel<string[] | undefined>('flexAreaTypesSelected') // undefined = not set (default all), [] = none selected
const flexColorBy = defineModel<string>('flexColorBy') // 'Agency' by default

// Derived checkbox state: checked (All Day) when both times are undefined, unchecked sets default times
const isAllDayMode = computed({
  get: () => startTime.value == null && endTime.value == null,
  set: (checked: boolean) => {
    if (checked) {
      // Emit event to parent to update both params in single navigation
      emit('setTimeRange', { startTime: undefined, endTime: undefined })
    } else {
      // Emit event to parent to update both params in single navigation
      emit('setTimeRange', { startTime: parseTime('00:00:00'), endTime: parseTime('23:59:00') })
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

function titleCase (s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

///////////////////
// Agency selector

const agencySearch = ref('')

const agencyFilterOptions = computed(() => {
  const items = props.agencyFilterItems || []
  return items
    .filter((a) => {
      const sv = agencySearch.value.toLowerCase()
      return !sv || a.name.toLowerCase().includes(sv)
    })
    .map(a => ({
      value: a.name,
      name: a.name,
      hasFixedRoute: a.hasFixedRoute,
      hasFlex: a.hasFlex,
    }))
})

// All available agency names (for checking if all are selected)
const allAgencyNames = computed(() => {
  return (props.agencyFilterItems || []).map(a => a.name)
})

// Local wrapper around selectedAgencies that handles undefined = "all selected"
// When undefined, treat as all agencies selected (no filter applied)
// When all are selected, store as undefined to maintain semantic meaning
const localSelectedAgencies = computed<string[]>({
  get () {
    // If undefined, return all agency names (all are selected)
    if (selectedAgencies.value === undefined) {
      return allAgencyNames.value
    }
    return selectedAgencies.value
  },
  set (newValue: string[]) {
    // If all agencies are selected, set to undefined (no filter)
    const allSelected = allAgencyNames.value.length > 0
      && newValue.length === allAgencyNames.value.length
      && allAgencyNames.value.every(name => newValue.includes(name))

    if (allSelected) {
      selectedAgencies.value = undefined
    } else {
      selectedAgencies.value = newValue
    }
  }
})

// Check if all agencies are currently selected
const allAgenciesSelected = computed(() => {
  return selectedAgencies.value === undefined
    || (selectedAgencies.value.length === allAgencyNames.value.length
      && allAgencyNames.value.every(name => selectedAgencies.value!.includes(name)))
})

// Check if no agencies are currently selected
const noAgenciesSelected = computed(() => {
  return selectedAgencies.value !== undefined && selectedAgencies.value.length === 0
})

function selectAllAgencies () {
  selectedAgencies.value = undefined // undefined = all selected
}

function selectNoAgencies () {
  selectedAgencies.value = []
}

// Check if an agency should be visually disabled based on service type toggles
// An agency is disabled if ALL of its service types are turned off
function isAgencyDisabled (agency: { hasFixedRoute: boolean, hasFlex: boolean }): boolean {
  // Fixed-route is off if fixedRouteEnabled is false OR if no route types are selected
  const fixedOff = fixedRouteEnabled.value === false
    || (selectedRouteTypes.value !== undefined && selectedRouteTypes.value.length === 0)
  const flexOff = flexServicesEnabled.value === false

  // If both service types are off, all agencies are disabled
  if (fixedOff && flexOff) {
    return true
  }

  // If fixed is off and agency only has fixed-route, it's disabled
  if (fixedOff && agency.hasFixedRoute && !agency.hasFlex) {
    return true
  }

  // If flex is off and agency only has flex, it's disabled
  if (flexOff && agency.hasFlex && !agency.hasFixedRoute) {
    return true
  }

  return false
}

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
    if (result.size === 7) { break } // we got them all
  }
  return result
})

// Get all available fixed-route type IDs
const allFixedRouteTypeIds = computed(() => {
  return [...routeTypeNames.keys()]
})

// Fixed-route mode options (without flex)
const fixedRouteModeOptions = computed(() => {
  return [...routeTypeNames].map(([routeType, routeTypeDesc]) => ({
    value: routeType,
    label: routeTypeDesc,
    icon: routeTypeIcons.get(routeType) || 'train-car',
  }))
})

// Local selected route types for checkbox binding
const localSelectedRouteTypes = computed<RouteType[]>({
  get () {
    // If undefined, all are selected
    if (selectedRouteTypes.value === undefined) {
      return allFixedRouteTypeIds.value
    }
    // Otherwise return the actual selection
    return selectedRouteTypes.value
  },
  set (newValue: RouteType[]) {
    if (newValue.length === 0) {
      // No modes selected
      selectedRouteTypes.value = []
      fixedRouteEnabled.value = false
    } else if (newValue.length === allFixedRouteTypeIds.value.length) {
      // All modes selected
      selectedRouteTypes.value = undefined
      fixedRouteEnabled.value = true
    } else {
      // Some modes selected
      selectedRouteTypes.value = newValue
      fixedRouteEnabled.value = true
    }
  }
})

// Check if a menu item should be disabled
function isMenuItemDisabled (item: { tab: string, requiresFixedRoute?: boolean, requiresFlex?: boolean }) {
  // Fixed-route tab should be disabled when no fixed-route modes are selected
  if (item.requiresFixedRoute) {
    // Check if fixedRouteEnabled is false OR if all fixed route modes are unchecked
    if (fixedRouteEnabled.value === false) {
      return true
    }
    // Also disable if selectedRouteTypes is explicitly empty array
    if (selectedRouteTypes.value !== undefined && selectedRouteTypes.value.length === 0) {
      return true
    }
  }
  // Flex tab should be disabled when flexServicesEnabled is explicitly false
  if (item.requiresFlex && flexServicesEnabled.value === false) {
    return true
  }
  return false
}
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
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
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
  a.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  .right-chev {
    float: right;
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

.agency-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.agency-icon {
  opacity: 0.6;
}

.agency-disabled {
  opacity: 0.4;

  .agency-label {
    text-decoration: line-through;
    color: var(--bulma-text-weak);
  }
}

.service-type-checkboxes {
  .mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
}

.mode-checkboxes {
  .mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
