<template>
  <article class="cal-map-legend message is-dark">
    <div class="message-header">
      Legend
    </div>

    <div class="message-body cal-map-legend-box">
      <!-- BBOX -->
      <div v-if="props.displayEditBboxMode" class="cal-map-legend-section">
        <div>
          <div class="legend-item legend-marker-square" style="border:solid red 1px;" />
          <div>Bounding Box for Query</div>
        </div>
        <div>
          <div class="legend-item legend-marker-round"><i class="mdi mdi-arrow-bottom-left" /></div>
          <div>SW Bounding Box Corner</div>
        </div>
        <div>
          <div class="legend-item legend-marker-round"><i class="mdi mdi-arrow-top-right" /></div>
          <div>NE Bounding Box Corner</div>
        </div>
      </div>

      <!-- Geometry Style -->
      <div v-if="props.dataDisplayMode === 'Route'" class="cal-map-legend-section">
        <div>
          <div class="legend-item legend-full-line"/>
          <div>Routes satisfying all filters</div>
        </div>
        <div>
          <div class="legend-item legend-dashed-line"/>
          <div>Routes not satisfying all filters</div>
        </div>
      </div>
      <div v-else-if="props.dataDisplayMode === 'Stop'" class="cal-map-legend-section">
        <div>
          <div class="legend-item legend-large-circle"/>
          <div>Stops satisfying all filters</div>
        </div>
        <div>
          <div class="legend-item legend-small-circle"/>
          <div>Stops not satisfying all filters</div>
        </div>
      </div>

      <!-- Color Style -->
      <div v-if="props.dataDisplayMode === 'Agency'" class="cal-map-legend-section">
        <div class="legend-heading">Agencies:</div>
        <div v-for="[color, label] of sampleAgencies" :key="routeType">
          <div class="legend-item legend-marker-square" :style="{background: color}" />
          <div>{{ label }}</div>
        </div>
      </div>
      <div v-else-if="props.colorKey === 'Mode'" class="cal-map-legend-section">
        <div class="legend-heading">Modes:</div>
        <div v-for="[color, label] of sampleModes" :key="routeType">
          <div class="legend-item legend-marker-square" :style="{background: color}" />
          <div>{{ label }}</div>
        </div>
      </div>
      <div v-else-if="props.colorKey === 'Frequency'" class="cal-map-legend-section">
        <div class="legend-heading">Avg. visits per day:</div>
        <div v-for="[color, label] of sampleVisits" :key="routeType">
          <div class="legend-item legend-marker-square" :style="{background: color}" />
          <div>{{ label }}</div>
        </div>
      </div>
      <div v-else-if="props.colorKey === 'Fare'" class="cal-map-legend-section">
        <div class="legend-heading">Fares:</div>
        <div v-for="[color, label] of sampleAgencies" :key="routeType">
          <div class="legend-item legend-marker-square" :style="{background: color}" />
          <div>{{ label }}</div>
        </div>
      </div>

    </div>

  </article>
</template>

<script setup lang="ts">
import { routeTypeColorMap, routeTypes } from '../constants'

const props = defineProps<{
  dataDisplayMode: string,
  colorKey: string,
  displayEditBboxMode?: boolean
}>()


// WIP: sample data
const sampleModes = new Map<string,string>(Object.entries({
  '#e41a1c': 'Light rail',
  '#ff7f00': 'Intercity rail',
  '#fee08b': 'Subway',
  '#1f78b4': 'Bus',
  '#984ea3': 'Ferry'
}));
const sampleAgencies = new Map<string,string>(Object.entries({
  '#e41a1c': 'Trimet',
  '#ff7f00': 'C Tran',
  '#fee08b': 'Amtrak',
  '#1f78b4': 'Greyhound',
  '#984ea3': 'Portland Streetcar'
}));
const sampleVisits = new Map<string,string>(Object.entries({
  '#e41a1c': '40+',
  '#ff7f00': '30-39',
  '#fee08b': '20-29',
  '#1f78b4': '10-19',
  '#984ea3': '0-0'
}));


</script>

<style scoped lang="scss">
.cal-map-legend {
  position: absolute;
  right: 50px;
  bottom: 30px;
  width: 300px;
  color: black;
  z-index: 100;
}

.cal-map-legend-box {
  display: flex;
  flex-direction: column;
  padding: 10px 15px;
  color: hsla(var(--bulma-text-h), var(--bulma-text-s), var(--bulma-text-l), 1.0);
  background: hsla(var(--bulma-white-h), var(--bulma-white-s), var(--bulma-scheme-main-l), 0.95);
}

.cal-map-legend-section {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;

  > div {
    display: flex;
    height: 30px;
    align-items: center;

    div:nth-child(2) {
      padding-left: 10px;
    }
  }
}

.legend-heading {
  font-weight: bold;
}

.legend-item {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  position: relative;
  i {
    font-size: 10px;
  }
}

.legend-marker-round {
  border-radius: 50%;
  background-color: white;
  border: 2px solid grey;
}

.legend-marker-square {
  background-color: #fff;
}

.legend-full-line {
  border-top: 4px solid #000f;
  margin-top: 16px;
  background-color: #0000;
}

.legend-dashed-line {
  border-top: 3px dotted #0006;
  margin-top: 15px;
  background-color: #0000;
}

.legend-large-circle {
  background-color: #000f;
  border-radius: 50%;
}

.legend-small-circle {
  width: 10px;
  height: 10px;
  margin: 5px;
  background-color: #0006;
  border-radius: 50%;
}


</style>
