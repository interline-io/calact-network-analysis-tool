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
        <cal-filter-timeframes />
      </div>

      <!-- FIXED-ROUTE SERVICES -->
      <div
        v-if="activeTab === 'transit-layers'"
        id="cal-filter-panel-transit-layers"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-transit-layers"
        tabindex="0"
      >
        <cal-filter-fixed-route
          :scenario-filter-result="props.scenarioFilterResult"
          :census-geography-layer-options="props.censusGeographyLayerOptions"
        />
      </div>

      <!-- FLEX SERVICES (DRT/Demand-Responsive Transit) -->
      <div
        v-if="activeTab === 'flex-services'"
        id="cal-filter-panel-flex-services"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-flex-services"
        tabindex="0"
      >
        <cal-filter-flex />
      </div>

      <!-- MODES & AGENCIES -->
      <div
        v-if="activeTab === 'agencies'"
        id="cal-filter-panel-agencies"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-agencies"
        tabindex="0"
      >
        <cal-filter-agencies :agency-filter-items="props.agencyFilterItems" />
      </div>

      <!-- DATA DISPLAY -->
      <div
        v-if="activeTab === 'data-display'"
        id="cal-filter-panel-data-display"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-data-display"
        tabindex="0"
      >
        <cal-filter-map-display :census-geography-layer-options="props.censusGeographyLayerOptions" />
      </div>

      <!-- SETTINGS -->
      <div
        v-if="activeTab === 'settings'"
        id="cal-filter-panel-settings"
        role="tabpanel"
        aria-labelledby="cal-filter-tab-settings"
        tabindex="0"
      >
        <cal-filter-settings />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  type AgencyFilterItem,
  fmtDate,
  PANEL_PADDING,
  FILTER_MAIN_WIDTH,
  FILTER_SUB_WIDTH,
} from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'
import type { CensusGeography } from '~~/src/tl/census'

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

const {
  startDate,
  endDate,
  geomSource,
  fixedRouteEnabled,
} = useScenarioInputs()
const {
  selectedRouteTypes,
  flexServicesEnabled,
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
</style>
