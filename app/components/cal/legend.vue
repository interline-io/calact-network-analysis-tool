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
            <div class="legend-item legend-marker-square cal-legend-geo-unselected" />
            <div>Unselected boundary</div>
          </div>
          <div>
            <div class="legend-item legend-marker-square cal-legend-geo-selected" />
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
        <div v-if="props.showAggAreas && props.hasChoroplethData" class="choropleth-legend">
          <div class="legend-heading">
            {{ props.choroplethClassification?.label || 'Aggregated Areas' }}
            <span v-if="props.choroplethClassification?.isDensity" class="cal-legend-unit-suffix">
              ({{ densityUnitLabel(props.unitSystem) }})
            </span>
          </div>
          <div v-if="props.choroplethClassification?.hasInsufficient" class="cal-choropleth-bucket">
            <div class="legend-item legend-marker-square cal-choropleth-insufficient" />
            <div>Insufficient data</div>
          </div>
          <div
            v-for="(color, i) in (props.choroplethClassification?.values.length ? props.choroplethClassification.palette : [])"
            :key="i"
            class="cal-choropleth-bucket"
          >
            <div class="legend-item legend-marker-square" :style="{ background: color }" />
            <div>{{ bucketLabel(i) }}</div>
          </div>
          <div class="cal-choropleth-details-link">
            <a href="#" @click.prevent="$emit('viewDetails')">
              View all details →
            </a>
          </div>
        </div>
      </div>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import {
  densityUnitLabel,
  formatCensusBucketLabel,
  type ChoroplethClassification,
  type DataDisplayMode,
  type UnitSystem,
} from '~~/src/core'

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
  choroplethClassification?: ChoroplethClassification
  isAllDayMode?: boolean
  unitSystem: UnitSystem
}>()

defineEmits<{
  viewDetails: []
}>()

const shouldShowLegend = computed(() => props.hasData || props.hasFlexData || props.displayEditBboxMode || props.showBbox || props.geomSource === 'adminBoundary' || (props.showAggAreas && props.hasChoroplethData))

function bucketLabel (i: number): string {
  const c = props.choroplethClassification
  if (!c) { return '' }
  const base = formatCensusBucketLabel(i, c.breaks, c.palette.length, c.format)
  return c.isDensity ? `${base} ${densityUnitLabel(props.unitSystem)}` : base
}
</script>

<style scoped lang="scss">
.cal-map-legend {
  // Positioning lives on the parent `.cal-map-sidebar` stack in map.vue.
  width: 100%;
  color: black;
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

.cal-legend-unit-suffix {
  font-weight: normal;
  font-size: 0.85em;
  opacity: 0.75;
  margin-left: 4px;
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

.cal-choropleth-bucket {
  display: flex;
  align-items: center;
  height: 22px;

  div:nth-child(2) {
    padding-left: 10px;
    font-size: 0.85em;
  }
}

// Swatch color must stay in sync with `CHOROPLETH_INSUFFICIENT_COLOR` in
// src/core/constants.ts (used for the matching map polygon fill).
.cal-choropleth-insufficient {
  background: #e0e0e0;
  border: 1px solid #bbb;
}

.cal-legend-geo-unselected {
  background-color: #cccccc;
  opacity: 0.6;
  border: 1px solid #666666;
}

.cal-choropleth-details-link {
  margin-top: 8px;
  font-size: 0.85em;

  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
}

.cal-legend-geo-selected {
  background-color: #dc3545;
  opacity: 0.7;
  border: 1px solid #dc3545;
}
</style>
