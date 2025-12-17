<template>
  <div class="cal-map-legend">
    <t-msg
      title="Legend"
      expandable
      :open="true"
      variant="dark"
    >
      <div class="cal-map-legend-box">
        <!-- BBOX -->
        <div v-if="props.displayEditBboxMode" class="cal-map-legend-section">
          <div>
            <div class="legend-item legend-marker-square" style="border:solid red 1px;" />
            <div>Bounding Box for Query</div>
          </div>
          <div>
            <div class="legend-item legend-marker-round">
              <i class="mdi mdi-arrow-bottom-left" />
            </div>
            <div>SW Bounding Box Corner</div>
          </div>
          <div>
            <div class="legend-item legend-marker-round">
              <i class="mdi mdi-arrow-top-right" />
            </div>
            <div>NE Bounding Box Corner</div>
          </div>
        </div>

        <!-- Geometry Style -->
        <div class="cal-map-legend-section">
          <div>
            <div class="legend-item legend-full-line" />
            <div>Routes satisfying all filters</div>
          </div>
          <div v-if="!props.hideUnmarked">
            <div class="legend-item legend-thin-line" />
            <div>Routes <em>not</em> satisfying all filters</div>
          </div>
          <div>
            <div class="legend-item legend-large-circle" />
            <div>Stops satisfying all filters</div>
          </div>
          <div v-if="!props.hideUnmarked">
            <div class="legend-item legend-small-circle" />
            <div>Stops <em>not</em> satisfying all filters</div>
          </div>
        </div>

        <!-- Color Style -->
        <div v-if="props.hasData" class="cal-map-legend-section">
          <div v-if="props.dataDisplayMode === 'Agency'" class="legend-heading">
            Agencies:
          </div>
          <div v-else-if="props.colorKey === 'Mode'" class="legend-heading">
            Transit Modes:
          </div>
          <div v-else-if="props.dataDisplayMode === 'Route' && props.colorKey === 'Frequency'" class="legend-heading">
            Avg. minutes:
          </div>
          <div v-else-if="props.dataDisplayMode === 'Stop' && props.colorKey === 'Frequency'" class="legend-heading">
            Avg. visits per day:
          </div>
          <div v-else-if="props.colorKey === 'Fare'" class="legend-heading">
            Fares:
          </div>
          <div v-for="s of styleData" :key="s.color">
            <div class="legend-item legend-marker-square" :style="{ background: s.color }" />
            <div>{{ s.label }}</div>
          </div>
        </div>

        <!-- Flex Services Color Style -->
        <div v-if="props.hasFlexData" class="legend-heading">
          Flex Service Areas:
        </div>
        <div v-if="props.hasFlexData" class="cal-map-legend-section">
          <div v-for="s of props.flexStyleData" :key="s.label">
            <div
              class="legend-item legend-flex-area"
              :style="{
                background: s.color,
                opacity: 0.4,
                border: `2px solid ${s.color}`,
              }"
            />
            <div class="legend-flex-label">
              {{ s.label }}
            </div>
          </div>
        </div>
        <!-- Flex filter status legend -->
        <div v-if="props.hasFlexData" class="cal-map-legend-section">
          <div>
            <div
              class="legend-item legend-flex-area"
              :style="{
                background: '#666',
                opacity: 0.3,
                border: '2px solid #666',
              }"
            />
            <div>Satisfying all filters</div>
          </div>
          <div v-if="!props.hideUnmarked">
            <div
              class="legend-item legend-flex-area-dashed"
              :style="{
                background: 'transparent',
                border: '2px dashed #999',
              }"
            />
            <div><em>Not</em> satisfying all filters</div>
          </div>
        </div>

        <div v-if="!props.hasData && !props.hasFlexData && !props.displayEditBboxMode">
          <p class="legend-loading">
            <t-loading
              :active="true"
              :full-page="false"
            />
          </p>
        </div>
      </div>
    </t-msg>
  </div>
</template>

<script setup lang="ts">
import type { DataDisplayMode } from '~~/src/core'

interface StyleItem {
  label: string
  color: string
}

const props = defineProps<{
  dataDisplayMode?: DataDisplayMode
  colorKey?: string
  styleData: StyleItem[]
  hasData: boolean
  displayEditBboxMode?: boolean
  hideUnmarked?: boolean
  // Flex Services props
  flexEnabled?: boolean
  flexColorBy?: string
  flexStyleData?: StyleItem[]
  hasFlexData?: boolean
}>()
</script>

<style scoped lang="scss">
.cal-map-legend {
  position: absolute;
  right: 50px;
  bottom: 30px;
  width: 300px;
  color: black;
  z-index: 10;
}

.message-header {
  cursor: pointer;
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

.legend-thin-line {
  border-top: 1.5px solid #aaa8;
  margin-top: 17px;
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
  background-color: #888888; /* default color for stops that don't match filters or are unstyled */
  border-radius: 50%;
}

.legend-loading {
  position: relative;
  height: 40px;
}

.legend-subheading {
  font-weight: normal;
  font-size: 0.85em;
  opacity: 0.8;
}

.legend-flex-area {
  border-radius: 3px;
}

.legend-flex-area-dashed {
  border-radius: 3px;
}

.legend-flex-label {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
