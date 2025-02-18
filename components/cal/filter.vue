<template>
  <div class="cal-filter">
    <div class="cal-filter-main">
      <tl-title>Filters</tl-title>

      <aside class="menu">
        <p class="menu-label">
          Filters
        </p>
        <ul class="menu-list">
          <li><a @click="setPanel('timeframes')">Timeframes <o-icon icon="chevron-right" size="small" /></a></li>
          <li><a @click="setPanel('transit-layers')">Transit Layers <o-icon icon="chevron-right" size="small" /></a></li>
          <li><a @click="setPanel('map')">Map Display <o-icon icon="chevron-right" size="small" /></a></li>
          <li><a @click="setPanel('settings')">Settings <o-icon icon="chevron-right" size="small" /></a></li>
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
              <o-checkbox size="small">
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
            <li v-for="routeType of routeTypes" :key="routeType">
              <o-checkbox size="small">
                {{ routeType }}
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
            <li v-for="agencyName of testAgencies" :key="agencyName">
              <o-checkbox size="small">
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
import { fmtDate } from '../geom'

const dowValues = [
  'All',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
]

const routeTypes = [
  'All',
  'Bus',
  'Rail',
  'Ferry',
  'Subway',
  'Streetcar'
]

const testAgencies = [
  'Agency 1',
  'Agency 2',
  'Agency 3',
]

const routeColorModes = [
  'Agency',
  'Frequency',
]

const activePanel = ref('')

function setPanel (v: string) {
  if (activePanel.value === v) {
    activePanel.value = ''
    return
  }
  activePanel.value = v
}

const currencyType = ref('usa')

const props = defineProps<{
  startDate: Date
  endDate?: Date
}>()
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
    background:#ccc;
    padding:20px;
  }
}
.menu-list .icon {
  float:right;
}
</style>
