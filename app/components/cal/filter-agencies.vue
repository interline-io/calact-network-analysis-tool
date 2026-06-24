<template>
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
</template>

<script setup lang="ts">
import {
  type RouteType,
  type AgencyFilterItem,
  routeTypeNames,
  routeTypeIcons,
} from '~~/src/core'

const props = defineProps<{
  agencyFilterItems?: AgencyFilterItem[]
}>()

const { fixedRouteEnabled } = useScenarioInputs()
const {
  selectedRouteTypes,
  selectedAgencies,
  flexServicesEnabled,
} = useScenarioFilters()

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
</script>

<style scoped lang="scss">
.filter-legend {
  font-size: 10pt;
  margin-top: 10px;
  margin-bottom: 40px;
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
