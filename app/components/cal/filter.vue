<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <cal-title title="Filters" />

      <nav class="menu" aria-label="Filters">
        <p id="cal-filter-menu-label" class="menu-label">
          Filters
        </p>
        <cat-button
          class="mx-4 mb-4"
          icon-left="delete"
          @click="emit('resetFilters')"
        >
          Clear all
        </cat-button>
        <ul
          class="menu-list"
          role="tablist"
          aria-orientation="vertical"
          aria-labelledby="cal-filter-menu-label"
        >
          <li
            v-for="(item, idx) of menuItems"
            :key="item.tab"
            role="presentation"
          >
            <button
              :id="`cal-filter-tab-${item.tab}`"
              ref="tabRefs"
              type="button"
              role="tab"
              class="cal-filter-tab-button"
              :class="{ 'is-active': activeTab === item.tab, 'is-disabled': isMenuItemDisabled(item) }"
              :aria-selected="activeTab === item.tab"
              :aria-controls="activeTab === item.tab ? `cal-filter-panel-${item.tab}` : undefined"
              :aria-disabled="isMenuItemDisabled(item) || undefined"
              :tabindex="isTabTabbable(item, idx) ? 0 : -1"
              @click="!isMenuItemDisabled(item) && setTab(item.tab)"
              @keydown="(e: KeyboardEvent) => onTabKeydown(e, idx)"
            >
              <cat-icon
                :icon="item.icon"
                class="is-fullwidth"
              />
              {{ item.label }}
              <cat-icon
                class="right-chev"
                icon="chevron-right"
                size="small"
              />
            </button>
          </li>
        </ul>
      </nav>

      <div class="cal-filter-summary">
        <p>
          Showing data for:<br>
          {{ fmtDate(startDate) }}
          <span v-if="endDate">
            - {{ fmtDate(endDate) }}
          </span>
        </p>
        <p class="cal-filter-summary-geo">
          {{ geographicBoundaryLabel }}
        </p>
        <div v-if="props.scenarioFilterResult" class="cal-filter-summary-counts">
          <span>{{ markedRouteCount }} of {{ totalRouteCount }} routes</span>
          <span>{{ markedStopCount }} of {{ totalStopCount }} stops</span>
          <span v-if="props.aggregateGeoCount">{{ props.aggregateGeoCount }} {{ props.aggregateLayerLabel }}</span>
        </div>
        <p>
          <a @click="emit('showQuery')">Change date or region</a>
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
          <cat-icon
            icon="chevron-left"
            size="large"
          />
        </button>
      </div>

      <!-- TIMEFRAMES -->
      <div
        v-if="activeTab === 'timeframes'"
        id="cal-filter-panel-timeframes"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-timeframes"
        tabindex="0"
      >
        <cat-fieldset label="Days of the week" class="cal-filter-days block">
          <section class="cal-day-of-week-mode menu-list">
            <cat-field>
              <cat-radio
                v-model="selectedWeekdayMode"
                name="selectedWeekdayMode"
                native-value="Any"
                label="Any of the following days"
              />
            </cat-field>
            <cat-field>
              <cat-radio
                v-model="selectedWeekdayMode"
                name="selectedWeekdayMode"
                native-value="All"
                label="All of the following days"
              />
            </cat-field>
          </section>
          <cat-checkbox-group
            v-model="selectedWeekdays"
            :options="dowValues.map(d => ({ value: d, label: titleCase(d), disabled: !dowAvailable.has(d) }))"
          />
        </cat-fieldset>

        <cat-fieldset class="cal-filter-times block">
          <template #label>
            Time of Day
            <cat-tooltip
              text="Fixed-route transit: Filters to show only departures within the selected time window. Flex service areas: Filters to show only areas with service windows that overlap with the selected time range."
              position="left"
            >
              <i class="mdi mdi-information-outline" />
            </cat-tooltip>
          </template>

          <cat-field class="cal-time-of-day-mode">
            <cat-checkbox
              v-model="isAllDayMode"
              label="All Day"
            />
          </cat-field>

          <p class="menu-label">
            Starting
          </p>

          <cat-field>
            <cal-timepicker
              ref="startTimeRef"
              v-model="startTime"
              size="small"
              icon="clock"
              :disabled="isAllDayMode"
            />
          </cat-field>

          <p class="menu-label">
            Ending
          </p>

          <cat-field>
            <cal-timepicker
              v-model="endTime"
              size="small"
              icon="clock"
              :disabled="isAllDayMode"
            />
          </cat-field>
        </cat-fieldset>
      </div>

      <!-- FIXED-ROUTE SERVICES -->
      <div
        v-if="activeTab === 'transit-layers'"
        id="cal-filter-panel-transit-layers"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-transit-layers"
        tabindex="0"
      >
        <aside class="cal-service-levels menu">
          <p class="menu-label">
            Frequency
          </p>

          <cat-field grouped>
            <cat-checkbox
              v-model="frequencyUnderEnabled"
              label="Avg. Frequency ≦"
            />
            <div class="cal-input-width-80">
              <cat-input
                v-model="frequencyUnder"
                type="number"
                min="0"
                :disabled="!frequencyUnderEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </cat-field>

          <cat-field grouped>
            <cat-checkbox
              v-model="frequencyOverEnabled"
              label="Avg. Frequency >"
            />
            <div class="cal-input-width-80">
              <cat-input
                v-model="frequencyOver"
                type="number"
                min="0"
                :disabled="!frequencyOverEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </cat-field>

          <cat-field>
            <cat-checkbox
              v-model="calculateFrequencyMode"
              label="Calculate frequency based on single routes"
              :disabled="true"
            />
          </cat-field>

          <p class="menu-label">
            <cat-tooltip text="Apportions census data to the area within this radius of each stop. Used in the Stops, Routes, Agencies, and Aggregation tables. Set to 0 to disable.">
              Stop statistical radius
              <cat-icon icon="information" />
            </cat-tooltip>
          </p>
          <cat-field>
            <div class="level">
              <div class="level-item">
                <cat-slider
                  v-model="stopBufferRadius"
                  :min="0"
                  :max="1600"
                />
              </div>
              <div class="level-right">
                <div class="ml-4 level-item">
                  <div class="cal-input-width-100">
                    <cat-input
                      v-model="stopBufferRadius"
                      type="number"
                      min="0"
                    />
                  </div>
                  <div class="ml-2">
                    m
                  </div>
                </div>
              </div>
            </div>
          </cat-field>

          <cat-field v-if="stopBufferRadius > 0">
            <template #label>
              <cat-tooltip text="Census layer used for buffer intersections. Tract is the default; finer layers (block group) give more precise apportionment when loaded on the backend. Switching layers triggers a buffer-only refetch — the scenario stays loaded.">
                Buffer layer
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-select v-model="stopBufferLayer">
              <option
                v-for="option of censusGeographyLayerOptions"
                :key="option.value"
                :value="option.value"
                :disabled="!HIERARCHICAL_TIGER_LAYERS.has(option.value)"
              >
                {{ option.label }}{{ HIERARCHICAL_TIGER_LAYERS.has(option.value) ? '' : ' (not supported)' }}
              </option>
            </cat-select>
          </cat-field>

          <p class="menu-label">
            <cat-tooltip text="Finds clusters of nearby stops served by different agencies — potential transfer hubs. Max distance is the largest gap (meters) between stops in a cluster; max transfer time requires each stop to have a departure within that many minutes of another stop in the cluster. Changing the distance triggers a cluster-only refetch — the scenario stays loaded.">
              Stop Clustering
              <cat-icon icon="information" />
            </cat-tooltip>
          </p>
          <cat-field>
            <cat-checkbox
              v-model="clusterEnabled"
              label="Cluster nearby stops across agencies"
            />
          </cat-field>
          <p class="cal-cluster-sublabel">
            Max distance
          </p>
          <cat-field>
            <div class="level">
              <div class="level-item">
                <cat-slider
                  v-model="clusterDistance"
                  :min="1"
                  :max="800"
                  :disabled="!clusterEnabled"
                />
              </div>
              <div class="level-right">
                <div class="ml-4 level-item">
                  <div class="cal-input-width-100">
                    <cat-input
                      v-model="clusterDistance"
                      type="number"
                      min="0"
                      :disabled="!clusterEnabled"
                    />
                  </div>
                  <div class="ml-2">
                    m
                  </div>
                </div>
              </div>
            </div>
          </cat-field>
          <p class="cal-cluster-sublabel">
            Max transfer time
          </p>
          <cat-field grouped>
            <div class="cal-input-width-80">
              <cat-input
                v-model="clusterMaxTransferMinutes"
                type="number"
                min="0"
                :disabled="!clusterEnabled"
              />
            </div>
            <div>
              minutes
            </div>
          </cat-field>

          <p class="menu-label">
            Fares <cat-tooltip text="Fare filtering is planned for future implementation">
              <i class="mdi mdi-information-outline" />
            </cat-tooltip>
          </p>

          <cat-field grouped>
            <cat-checkbox
              v-model="maxFareEnabled"
              label="Maximum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <cat-input
                v-model="maxFare"
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </cat-field>

          <cat-field grouped>
            <cat-checkbox
              v-model="minFareEnabled"
              label="Minimum fare $"
              :disabled="true"
            />
            <div class="cal-input-width-100">
              <cat-input
                v-model="minFare"
                type="number"
                min="0"
                step="0.01"
                :disabled="true"
              />
            </div>
          </cat-field>
          <cat-fieldset label="Color by">
            <ul>
              <li
                v-for="dataDisplayModeOption of dataDisplayModes"
                :key="dataDisplayModeOption"
              >
                <cat-radio
                  v-model="dataDisplayMode"
                  :native-value="dataDisplayModeOption"
                >
                  {{ dataDisplayModeOption }}
                </cat-radio>
              </li>
            </ul>
          </cat-fieldset>
        </aside>
      </div>

      <!-- FLEX SERVICES (DRT/Demand-Responsive Transit) -->
      <div
        v-if="activeTab === 'flex-services'"
        id="cal-filter-panel-flex-services"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-flex-services"
        tabindex="0"
      >
        <aside class="menu">
          <cat-notification
            variant="warning"
          >
            <span>
              Flex service data may be incomplete. Please contact relevant agencies for additional information.
            </span>
          </cat-notification>

          <div :class="{ 'is-disabled': !flexServicesEnabled }">
            <p class="menu-label">
              Advance notice
            </p>
            <cat-checkbox-group
              v-model="flexAdvanceNotice"
              :options="flexAdvanceNoticeTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
            />

            <p class="menu-label">
              Show areas that allow:
            </p>
            <cat-checkbox-group
              v-model="flexAreaTypesSelected"
              :options="flexAreaTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
            />

            <cat-fieldset label="Color by" :disabled="!flexServicesEnabled">
              <ul>
                <li
                  v-for="colorMode of flexColorByModes"
                  :key="colorMode"
                >
                  <cat-radio
                    v-model="flexColorBy"
                    :native-value="colorMode"
                    :disabled="!flexServicesEnabled"
                  >
                    {{ colorMode }}
                  </cat-radio>
                </li>
              </ul>
            </cat-fieldset>
          </div>
        </aside>
      </div>

      <!-- MODES & AGENCIES -->
      <div
        v-if="activeTab === 'agencies'"
        id="cal-filter-panel-agencies"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-agencies"
        tabindex="0"
      >
        <aside class="menu">
          <cat-fieldset label="Service Types" class="service-type-checkboxes mb-4">
            <cat-field>
              <cat-checkbox
                v-model="fixedRouteEnabled"
              >
                <span class="mode-label">
                  <cat-icon icon="train-car" size="small" />
                  Fixed-Route
                </span>
              </cat-checkbox>
            </cat-field>
            <cat-field>
              <cat-checkbox
                v-model="flexServicesEnabled"
              >
                <span class="mode-label">
                  <cat-icon icon="van-utility" size="small" />
                  Flex
                </span>
              </cat-checkbox>
            </cat-field>
          </cat-fieldset>

          <cat-fieldset v-if="fixedRouteEnabled" label="Fixed-Route Modes" class="mode-checkboxes mb-4">
            <cat-field
              v-for="mode in fixedRouteModeOptions"
              :key="mode.value"
            >
              <cat-checkbox
                v-model="localSelectedRouteTypes"
                :native-value="mode.value"
              >
                <span class="mode-label">
                  <cat-icon :icon="mode.icon" size="small" />
                  {{ mode.label }}
                </span>
              </cat-checkbox>
            </cat-field>
          </cat-fieldset>

          <p class="menu-label">
            Agencies
          </p>

          <cat-field>
            <cat-input
              v-model="agencySearch"
              type="search"
              placeholder="search"
              icon-right="magnify"
              icon-right-clickable
            />
          </cat-field>
          <div class="buttons mb-4">
            <!-- Note: selects ALL agencies in the dataset, not just the filtered list -->
            <cat-button
              size="small"
              :disabled="allAgenciesSelected"
              @click="selectAllAgencies"
            >
              Select All
            </cat-button>
            <cat-button
              size="small"
              :disabled="noAgenciesSelected"
              @click="selectNoAgencies"
            >
              Select None
            </cat-button>
          </div>

          <p
            v-if="!fixedRouteEnabled || !flexServicesEnabled"
            class="filter-legend mb-3"
          >
            <em>Grayed-out agencies do not match selected service types</em>
          </p>

          <div class="agency-checkbox-list">
            <cat-field
              v-for="agency in agencyFilterOptions"
              :key="agency.value"
              :class="{ 'agency-disabled': isAgencyDisabled(agency) }"
            >
              <cat-checkbox
                v-model="localSelectedAgencies"
                :native-value="agency.value"
              >
                <span class="agency-label">
                  {{ agency.name }}
                  <cat-tooltip
                    v-if="agency.hasFixedRoute"
                    text="Has fixed-route service"
                    position="right"
                  >
                    <cat-icon
                      icon="train-car"
                      size="small"
                      class="agency-icon"
                    />
                  </cat-tooltip>
                  <cat-tooltip
                    v-if="agency.hasFlex"
                    text="Has flex service"
                    position="right"
                  >
                    <cat-icon
                      icon="van-utility"
                      size="small"
                      class="agency-icon"
                    />
                  </cat-tooltip>
                </span>
              </cat-checkbox>
            </cat-field>
          </div>
        </aside>
      </div>

      <!-- DATA DISPLAY -->
      <div
        v-if="activeTab === 'data-display'"
        id="cal-filter-panel-data-display"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-data-display"
        tabindex="0"
      >
        <aside class="menu">
          <cat-fieldset>
            <template #label>
              Base map <cat-tooltip text="Switch the reference map displayed underneath transit route and stop features. Currently only an OpenStreetMap base map is available. Aerial imagery may be added in the future">
                <i class="mdi mdi-information-outline" />
              </cat-tooltip>
            </template>
            <ul>
              <li
                v-for="baseMapStyle of baseMapStyles"
                :key="baseMapStyle.name"
              >
                <cat-radio
                  v-model="baseMap"
                  :native-value="baseMapStyle.name"
                  :disabled="!baseMapStyle.available"
                >
                  <span class="cal-radio-with-icon">
                    <cat-icon
                      :icon="baseMapStyle.icon"
                      size="small"
                    /> {{ baseMapStyle.name }}
                  </span>
                </cat-radio>
              </li>
            </ul>
          </cat-fieldset>
          <p class="menu-label">
            Aggregation
          </p>
          <ul>
            <li>
              <cat-checkbox v-model="showAggAreas">
                Show Agg. Areas
              </cat-checkbox>
            </li>
          </ul>
          <cat-field class="mt-2">
            <template #label>
              Aggregate by
            </template>
            <cat-select
              v-model="aggregateLayer"
            >
              <option
                v-for="option of censusGeographyLayerOptions"
                :key="option.value"
                :value="option.value"
                :disabled="stopBufferRadius > 0 && !HIERARCHICAL_TIGER_LAYERS.has(option.value)"
              >
                {{ option.label }}{{ stopBufferRadius > 0 && !HIERARCHICAL_TIGER_LAYERS.has(option.value) ? ' (needs radius = 0)' : '' }}
              </option>
            </cat-select>
          </cat-field>
          <cat-field class="mt-2">
            <template #label>
              Shade map by
            </template>
            <cat-select
              v-model="choroplethElement"
            >
              <option
                v-for="option of CHOROPLETH_ELEMENT_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </cat-select>
          </cat-field>
          <div class="mt-2">
            <cat-checkbox
              v-model="shadeByDensity"
              :disabled="!shadeByDensityEligible"
            >
              Shade as density (per km²)
            </cat-checkbox>
          </div>
          <div class="mt-2">
            <cat-checkbox v-model="onlyWithStops">
              Only show geographies with stops
            </cat-checkbox>
          </div>

          <p class="menu-label">
            Overlay
          </p>
          <ul>
            <li>
              <cat-checkbox v-model="showBbox">
                Show geographic filters
              </cat-checkbox>
            </li>
          </ul>
          <p class="menu-label">
            Display Options
          </p>
          <ul>
            <li>
              <cat-checkbox v-model="showFiltered">
                Show filtered routes/stops
              </cat-checkbox>
            </li>
          </ul>
        </aside>
      </div>

      <!-- SETTINGS -->
      <div
        v-if="activeTab === 'settings'"
        id="cal-filter-panel-settings"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-settings"
        tabindex="0"
      >
        <aside class="menu">
          <cat-fieldset label="Units of measurement">
            <ul>
              <li>
                <cat-radio
                  v-model="unitSystem"
                  native-value="us"
                >
                  🇺🇸 USA
                </cat-radio>
              </li>
              <li>
                <cat-radio
                  v-model="unitSystem"
                  native-value="eu"
                >
                  🇪🇺 Metric
                </cat-radio>
              </li>
            </ul>
          </cat-fieldset>
        </aside>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { eachDayOfInterval } from 'date-fns'
import {
  type Weekday,
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
  parseTime,
  DEFAULT_TIME_WINDOW,
  CHOROPLETH_ELEMENT_OPTIONS,
  isElementDensityEligible,
  PANEL_PADDING,
  FILTER_MAIN_WIDTH,
  FILTER_SUB_WIDTH,
  HIERARCHICAL_TIGER_LAYERS,
  STOP_CLUSTER_DEFAULT_DISTANCE,
} from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'
import type { CensusGeography } from '~~/src/tl/census'
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
  censusGeographiesSelected?: CensusGeography[]
  censusGeographyLayerOptions?: { label: string, value: string }[]
  aggregateGeoCount?: number
  aggregateLayerLabel?: string
}>()

const shadeByDensityEligible = computed(() => isElementDensityEligible(choroplethElement.value))

const {
  showAggAreas,
  aggregateLayer,
  choroplethElement,
  shadeByDensity,
  onlyWithStops,
  dataDisplayMode,
  hideUnmarked,
  baseMap,
  unitSystem,
  showBbox,
} = useScenarioDisplay()
const {
  startDate,
  endDate,
  geomSource,
  fixedRouteEnabled,
  stopBufferRadius,
  stopBufferLayer,
  clusterDistance,
} = useScenarioInputs()
const {
  startTime,
  endTime,
  selectedWeekdayMode,
  selectedRouteTypes,
  selectedWeekdays,
  selectedAgencies,
  frequencyUnder,
  frequencyOver,
  calculateFrequencyMode,
  maxFareEnabled,
  maxFare,
  minFareEnabled,
  minFare,
  flexServicesEnabled,
  flexAdvanceNotice,
  flexAreaTypesSelected,
  flexColorBy,
  clusterMaxTransferMinutes,
  setTimeRange,
} = useScenarioFilters()

const geographicBoundaryLabel = computed(() => {
  if (geomSource.value === 'adminBoundary' && props.censusGeographiesSelected?.length) {
    return props.censusGeographiesSelected
      .map(g => g.adm1_name ? `${g.name}, ${g.adm1_name}` : g.name)
      .join('; ')
  }
  if (geomSource.value === 'mapExtent') {
    return 'Selected map extent'
  }
  return 'Selected bounding box'
})

// Route/stop/flex area count summaries
const totalRouteCount = computed(() => props.scenarioFilterResult?.routes.length ?? 0)
const markedRouteCount = computed(() => (props.scenarioFilterResult?.routes ?? []).reduce((n, r) => n + (r.marked ? 1 : 0), 0))
const totalStopCount = computed(() => props.scenarioFilterResult?.stops.length ?? 0)
const markedStopCount = computed(() => (props.scenarioFilterResult?.stops ?? []).reduce((n, s) => n + (s.marked ? 1 : 0), 0))

const panelMainWidthPx = `${FILTER_MAIN_WIDTH}px`
const panelSubWidthPx = `${FILTER_SUB_WIDTH}px`
const panelPaddingPx = `${PANEL_PADDING}px`

const emit = defineEmits([
  'resetFilters',
  'showQuery',
])
const activeTab = defineModel<string>('activeTab')

const showFiltered = computed({
  get: () => !hideUnmarked.value,
  set: (v: boolean) => { hideUnmarked.value = !v }
})

// Derived checkbox state: checked when value is defined, unchecked sets to undefined
const frequencyUnderEnabled = computed({
  get: () => frequencyUnder.value != null,
  set: (checked: boolean) => { frequencyUnder.value = checked ? 15 : undefined }
})
const frequencyOverEnabled = computed({
  get: () => frequencyOver.value != null,
  set: (checked: boolean) => { frequencyOver.value = checked ? 15 : undefined }
})
// #330 — clustering enable derives from the distance (0 = disabled). Checking
// seeds the default distance; unchecking clears it (which disables the phase).
const clusterEnabled = computed({
  get: () => clusterDistance.value > 0,
  set: (checked: boolean) => { clusterDistance.value = checked ? STOP_CLUSTER_DEFAULT_DISTANCE : 0 }
})

// Derived checkbox state: checked (All Day) when both times are undefined, unchecked sets default times
const isAllDayMode = computed({
  get: () => startTime.value == null && endTime.value == null,
  set: (checked: boolean) => {
    if (checked) {
      setTimeRange(undefined, undefined)
    } else {
      setTimeRange(parseTime(DEFAULT_TIME_WINDOW.start), parseTime(DEFAULT_TIME_WINDOW.end))
    }
  }
})

///////////////////
// Tab

const tabRefs = ref<HTMLButtonElement[]>([])

// A tab is tabbable when it's the active one, or — when no tab is active —
// when it's the first enabled tab. Keeps the tablist reachable via Tab even
// before any panel is open. Per the WAI-ARIA tabs pattern.
function isTabTabbable (item: typeof menuItems[number], idx: number): boolean {
  if (activeTab.value) {
    return activeTab.value === item.tab
  }
  if (isMenuItemDisabled(item)) {
    return false
  }
  const firstEnabledIdx = menuItems.findIndex(m => !isMenuItemDisabled(m))
  return idx === firstEnabledIdx
}

function setTab (v: string) {
  if (activeTab.value === v) {
    activeTab.value = ''
    return
  }
  activeTab.value = v
}

// When the sub-panel closes (e.g. via the Close button inside it) the element
// holding focus is removed, dumping focus onto <body>. Restore focus to the
// previously-active tab button so keyboard users don't lose their place.
watch(activeTab, async (newVal, oldVal) => {
  if (oldVal && !newVal) {
    await nextTick()
    const idx = menuItems.findIndex(m => m.tab === oldVal)
    if (idx >= 0) {
      tabRefs.value[idx]?.focus()
    }
  }
})

// Move focus to a tab at the given index, skipping disabled tabs.
function focusTabAt (startIdx: number, direction: 1 | -1) {
  const n = menuItems.length
  for (let step = 1; step <= n; step++) {
    const idx = ((startIdx + step * direction) % n + n) % n
    const item = menuItems[idx]
    if (item && !isMenuItemDisabled(item)) {
      tabRefs.value[idx]?.focus()
      setTab(item.tab)
      return
    }
  }
}

function onTabKeydown (e: KeyboardEvent, idx: number) {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      e.preventDefault()
      focusTabAt(idx, 1)
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      e.preventDefault()
      focusTabAt(idx, -1)
      break
    case 'Home':
      e.preventDefault()
      focusTabAt(-1, 1)
      break
    case 'End':
      e.preventDefault()
      focusTabAt(menuItems.length, -1)
      break
  }
}

///////////////////
// Time of Day focus management (#361)

const startTimeRef = ref<{ focus: () => void } | null>(null)

// When the user disables "All Day", move focus to the newly enabled start time
// picker so keyboard users can begin editing without hunting for it.
watch(isAllDayMode, async (allDay, prevAllDay) => {
  if (prevAllDay && !allDay) {
    await nextTick()
    startTimeRef.value?.focus()
  }
})

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
      // No modes selected - store empty array but don't change fixedRouteEnabled
      // The user may want to keep Fixed Route enabled while filtering to no specific modes
      selectedRouteTypes.value = []
    } else {
      // Check if all modes are selected (similar to localSelectedAgencies check)
      const allSelected = allFixedRouteTypeIds.value.length > 0
        && newValue.length === allFixedRouteTypeIds.value.length
        && allFixedRouteTypeIds.value.every(id => newValue.includes(id))

      if (allSelected) {
        // All modes selected - use undefined to represent "all"
        selectedRouteTypes.value = undefined
      } else {
        // Some modes selected
        selectedRouteTypes.value = newValue
      }
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
  padding-left: v-bind(panelPaddingPx);
}

.cal-filter-main {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: v-bind(panelMainWidthPx);

  .menu {
    flex-grow: 1;
  }
}

.cal-filter-summary {
  padding-bottom: v-bind(panelPaddingPx);
}

.cal-filter-summary-geo {
  word-wrap: break-word;
  padding-right: v-bind(panelPaddingPx);
}

.cal-filter-summary-counts {
  display: flex;
  flex-direction: column;
}

.cal-filter-sub {
  width: v-bind(panelSubWidthPx);
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

// #330 — sub-label for the Max distance / transfer controls under Stop Clustering.
.cal-cluster-sublabel {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.menu-list {
  a.is-active,
  .cal-filter-tab-button.is-active {
    color: var(--bulma-text-main-ter);
    background: var(--bulma-scheme-main-ter);
  }
  a.is-disabled,
  .cal-filter-tab-button.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  .right-chev {
    float: right;
  }
}

// Inherit menu-list anchor look so the tablist buttons match the previous design.
.cal-filter-tab-button {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0.5em 0.75em;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;

  &:hover:not(.is-active):not(.is-disabled) {
    background: var(--bulma-background);
  }

  &:focus-visible {
    outline: 2px solid var(--bulma-primary);
    outline-offset: -2px;
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
