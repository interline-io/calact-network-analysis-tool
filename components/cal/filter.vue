<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <tl-title title="Filters" />

      <aside class="menu">
        <p class="menu-label">
          Filters
        </p>
        <o-button class="mx-4" icon-left="delete" @click="emit('resetFilters')">
          Clear all
        </o-button>
        <ul class="menu-list">
          <li>
            <a @click="setPanel('timeframes')">
              <o-icon icon="chart-bar" />
              Timeframes
              <o-icon class="right-chev" icon="chevron-right" size="small" />
            </a>
          </li>
          <li>
            <a @click="setPanel('transit-layers')">
              <o-icon icon="bus" />
              Transit Layers
              <o-icon class="right-chev" icon="chevron-right" size="small" />
            </a>
          </li>
          <li>
            <a @click="setPanel('map')">
              <o-icon icon="layers-outline" />
              Map Display
              <o-icon class="right-chev" icon="chevron-right" size="small" />
            </a>
          </li>
          <li>
            <a @click="setPanel('settings')">
              <o-icon icon="cog" />
              Settings
              <o-icon class="right-chev" icon="chevron-right" size="small" />
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
        <aside class="menu">
          <p class="menu-label">
            Days of the week
          </p>
          <ul>
            <li v-for="dowValue of dowValues" :key="dowValue">
              <o-checkbox v-model="selectedDaysShadow" size="small" :native-value="dowValue">
                {{ dowValue }}
              </o-checkbox>
            </li>
          </ul>
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
              <o-checkbox v-model="selectedRouteTypesShadow" size="small" :native-value="routeType">
                {{ routeTypeDesc }}
              </o-checkbox>
            </li>
          </ul>

          <p class="menu-label">
            Agencies
          </p>

          <p class="menu-label">
            <o-field grouped>
              <o-input type="text" placeholder="search" />
              <o-field addons>
                <o-button>
                  None
                </o-button>
                <o-button>
                  All
                </o-button>
              </o-field>
            </o-field>
          </p>
          <ul>
            <li v-for="agencyName of knownAgencies" :key="agencyName">
              <o-checkbox v-model="selectedAgenciesShadow" size="small" :native-value="agencyName">
                {{ agencyName }}
              </o-checkbox>
            </li>
          </ul>
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
              <o-checkbox size="small">
                {{ routeColorMode }}
              </o-checkbox>
            </li>
          </ul>
          <p class="menu-label">
            Base map
          </p>
          <p class="menu-label">
            <o-icon icon="map-search" size="large" />
            <o-icon icon="map-search" size="large" />
            <o-icon icon="map-search" size="large" />
          </p>
        </aside>
      </div>

      <!-- SETTINGS -->
      <div v-if="activePanel === 'settings'">
        <aside class="menu">
          <p class="menu-label">
            Units of measurement
          </p>
          <ul>
            <li><o-radio><o-icon icon="currency-usd" />USA #1</o-radio></li>
            <li><o-radio><o-icon icon="currency-eur" />Metric</o-radio></li>
          </ul>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Feature, fmtDate } from '../geom'
import { defineEmits } from 'vue'

const dowValues = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
]

const routeTypes = new Map<string, string>(Object.entries({
  0: 'Streetcar',
  1: 'Rail',
  2: 'Subway',
  3: 'Bus',
  4: 'Ferry',
}))

const routeColorModes = [
  'Agency',
  'Frequency',
]

const props = defineProps<{
  stopFeatures: Feature[]
  startDate: Date
  endDate?: Date
  selectedRouteTypes: string[]
  selectedDays: string[]
  selectedAgencies: string[]
}>()

const emit = defineEmits([
  'setSelectedDays',
  'setSelectedRouteTypes',
  'setSelectedAgencies',
  'resetFilters'
])

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
const knownAgencies = computed(() => {
  const agencies = new Set<string>()
  for (const feature of props.stopFeatures) {
    for (const rs of feature.properties.route_stops) {
      agencies.add(rs.route.agency.agency_name)
    }
  }
  return Array.from(agencies)
})

///////////////////
// Shadowed props

const currencyType = ref('usa')

const selectedAgenciesShadow = computed({
  get () {
    const p = props.selectedAgencies.slice(0)
    return p.length === 0 ? knownAgencies.value : p
  },
  set (v) {
    emit('setSelectedAgencies', v)
  }
})

const selectedRouteTypesShadow = computed({
  get () {
    const p = props.selectedRouteTypes.slice(0)
    return p.length === 0 ? Array.from(routeTypes.keys()) : p
  },
  set (v) {
    emit('setSelectedRouteTypes', v)
  }
})

const selectedDaysShadow = computed({
  get () {
    const p = props.selectedDays.slice(0)
    return p.length === 0 ? dowValues : p
  },
  set (v) {
    emit('setSelectedDays', v)
  }
})

</script>

<style scoped lang="scss">
.cal-filter {
  display:flex;
  flex-direction:green;
  background: var(--bulma-scheme-main);
  height:100%;
  padding-left:20px;
  padding-right:20px;
  .cal-filter-main {
    display:flex;
    flex-direction: column;
    .menu {
      flex-grow:1;
      width:200px;
    }
  }
  .cal-filter-sub {
    display:flex;
    width:400px;
    flex-direction: column;
    background: var(--bulma-scheme-main-ter);
    padding:20px;
  }
}
.menu-list .right-chev {
  float:right;
}
</style>
