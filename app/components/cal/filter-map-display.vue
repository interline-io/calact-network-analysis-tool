<template>
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
    <cat-field>
      <template #label>
        <cat-tooltip text="Whether the aggregation overlay shades each area's full census values, the portion inside the query area, or the portion inside both the query area and the stop statistical radius.">
          Show Agg. Areas
          <cat-icon icon="information" />
        </cat-tooltip>
      </template>
      <cat-select v-model="aggAreaMode">
        <option value="off">
          Off
        </option>
        <option value="unclipped">
          Full geography
        </option>
        <option value="queryArea">
          Clipped to query area
        </option>
        <option value="buffer" :disabled="!props.bufferClipAvailable">
          Clipped to query area and stop radius{{ bufferClipHint }}
        </option>
      </cat-select>
    </cat-field>
    <cat-field class="mt-2">
      <template #label>
        Aggregate by
      </template>
      <cat-select
        v-model="aggregateLayer"
      >
        <option
          v-for="option of props.censusGeographyLayerOptions"
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
      <li>
        <cat-tooltip text="Outlines the area within the stop statistical radius of each route's stops.">
          <cat-checkbox v-model="showStopBuffer" :disabled="stopBufferRadius <= 0">
            Show stop buffers
          </cat-checkbox>
        </cat-tooltip>
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
</template>

<script setup lang="ts">
import {
  baseMapStyles,
  CHOROPLETH_ELEMENT_OPTIONS,
  isElementDensityEligible,
  HIERARCHICAL_TIGER_LAYERS,
} from '~~/src/core'

const props = defineProps<{
  censusGeographyLayerOptions?: { label: string, value: string }[]
  // False when the loaded scenario carries no stop-buffer clip to shade by.
  bufferClipAvailable?: boolean
}>()

const {
  aggAreaMode,
  showStopBuffer,
  aggregateLayer,
  choroplethElement,
  shadeByDensity,
  onlyWithStops,
  hideUnmarked,
  baseMap,
  showBbox,
} = useScenarioDisplay()
const { stopBufferRadius } = useScenarioInputs()

// Without a radius the user can fix it here; otherwise the scenario didn't
// produce a stop-buffer clip and re-running with a different query area is
// the only recourse.
const bufferClipHint = computed(() => {
  if (props.bufferClipAvailable) { return '' }
  return stopBufferRadius.value > 0
    ? ' (not available for this query area)'
    : ' (needs a stop radius)'
})

const shadeByDensityEligible = computed(() => isElementDensityEligible(choroplethElement.value))

const showFiltered = computed({
  get: () => !hideUnmarked.value,
  set: (v: boolean) => { hideUnmarked.value = !v }
})
</script>
