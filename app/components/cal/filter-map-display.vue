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
    <ul>
      <li>
        <cat-checkbox v-model="showAggAreas">
          Show Agg. Areas
        </cat-checkbox>
      </li>
    </ul>
    <cat-field class="mt-2">
      <template #label>
        Clipping mode <cat-tooltip text="How much of each census geography the map measures and draws. Clipped modes scale demographics to the part of the geography inside the area, draw it as that clipped footprint rather than its whole outline, and hide geographies the area doesn't reach.">
          <i class="mdi mdi-information-outline" />
        </cat-tooltip>
      </template>
      <cat-select
        v-model="aggClipMode"
      >
        <option
          v-for="option of AGG_CLIP_MODE_OPTIONS"
          :key="option.value"
          :value="option.value"
          :disabled="option.value === 'buffer' && !props.hasBufferClip"
        >
          {{ option.label }}{{ option.value === 'buffer' && !props.hasBufferClip ? ' (needs a stop radius)' : '' }}
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
        <cat-tooltip text="Shades the part of the query area within the stop statistical radius of the stops matching your filters — the same footprint the stop-buffer clipping mode measures. Draws nothing when the radius is 0.">
          <cat-checkbox v-model="showStopBuffer">
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
  AGG_CLIP_MODE_OPTIONS,
  baseMapStyles,
  CHOROPLETH_ELEMENT_OPTIONS,
  isElementDensityEligible,
  HIERARCHICAL_TIGER_LAYERS,
} from '~~/src/core'

const props = defineProps<{
  censusGeographyLayerOptions?: { label: string, value: string }[]
  // False until a loaded scenario carries buffer-clipped intersections.
  hasBufferClip?: boolean
}>()

const {
  showAggAreas,
  aggClipMode,
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

const shadeByDensityEligible = computed(() => isElementDensityEligible(choroplethElement.value))

const showFiltered = computed({
  get: () => !hideUnmarked.value,
  set: (v: boolean) => { hideUnmarked.value = !v }
})
</script>
