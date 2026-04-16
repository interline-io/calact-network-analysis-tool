<template>
  <div class="cal-map-legend" :class="{ 'is-hidden': !shouldShowLegend }">
    <cat-msg
      title="Legend"
      expandable
      :open="true"
      variant="dark"
    >
      <div class="cal-map-legend-box">
        <!-- Admin Boundary selection -->
        <div v-if="props.geomSource === 'adminBoundary'" class="cal-map-legend-section">
          <div>
            <div class="legend-item legend-marker-square legend-geo-unselected" />
            <div>Unselected boundary</div>
          </div>
          <div>
            <div class="legend-item legend-marker-square legend-geo-selected" />
            <div>Selected boundary</div>
          </div>
        </div>
        <!-- BBOX -->
        <div v-else-if="props.displayEditBboxMode || props.showBbox" class="cal-map-legend-section">
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
        <div v-if="props.hasData" class="cal-map-legend-section">
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
          <div v-else-if="props.dataDisplayMode === 'Transit mode'" class="legend-heading">
            Transit modes:
          </div>
          <div v-else-if="props.dataDisplayMode === 'Route frequency'" class="legend-heading">
            Avg. minutes between trips:
          </div>
          <div v-else-if="props.dataDisplayMode === 'Stop visits'" class="legend-heading">
            {{ props.isAllDayMode ? 'Total visits:' : 'Total visits in window:' }}
          </div>
          <div v-else-if="props.dataDisplayMode === 'Service area'" class="legend-heading">
            Service areas:
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
        <!-- Choropleth aggregation legend -->
        <div v-if="props.showAggAreas && props.hasChoroplethData" class="choropleth-legend">
          <div class="legend-heading">
            Aggregated Areas:
          </div>
          <div class="choropleth-legend-subtitle">
            {{ props.isAllDayMode ? 'Total visits' : 'Total visits in window' }}
          </div>
          <div class="choropleth-gradient-bar" :style="{ background: choroplethGradient }" />
          <div class="choropleth-gradient-labels">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import { choroplethPalette, type DataDisplayMode } from '~~/src/core'

interface StyleItem {
  label: string
  color: string
}

const props = defineProps<{
  dataDisplayMode?: DataDisplayMode
  styleData: StyleItem[]
  hasData: boolean
  displayEditBboxMode?: boolean
  showBbox?: boolean
  geomSource?: string
  hideUnmarked?: boolean
  // Flex Services props
  flexEnabled?: boolean
  flexColorBy?: string
  flexStyleData?: StyleItem[]
  hasFlexData?: boolean
  // Choropleth aggregation
  showAggAreas?: boolean
  hasChoroplethData?: boolean
  // Whether the active timeframe filter is "All Day" (no start/end time set)
  isAllDayMode?: boolean
}>()

const shouldShowLegend = computed(() => props.hasData || props.hasFlexData || props.displayEditBboxMode || props.showBbox || props.geomSource === 'adminBoundary' || (props.showAggAreas && props.hasChoroplethData))

const choroplethGradient = `linear-gradient(to right, ${choroplethPalette.join(', ')})`
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

.choropleth-legend {
  margin-bottom: 10px;
}

.choropleth-legend-subtitle {
  font-size: 0.85em;
  opacity: 0.8;
  margin-bottom: 4px;
}

.choropleth-gradient-bar {
  height: 12px;
  border-radius: 2px;
}

.choropleth-gradient-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  opacity: 0.8;
}

.legend-geo-unselected {
  background-color: #cccccc;
  opacity: 0.6;
  border: 1px solid #666666;
}

.legend-geo-selected {
  background-color: #dc3545;
  opacity: 0.7;
  border: 1px solid #dc3545;
}
</style>
