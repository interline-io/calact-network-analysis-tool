<template>
  <aside class="cal-service-levels menu">
    <p class="menu-label">
      Frequency
    </p>

    <cat-field grouped>
      <cat-checkbox
        v-model="frequencyUnderEnabled"
        label="Avg. Frequency ≦"
      />
      <div class="cal-input-width-80">
        <cat-input
          v-model="frequencyUnder"
          type="number"
          min="0"
          :disabled="!frequencyUnderEnabled"
        />
      </div>
      <div>
        minutes
      </div>
    </cat-field>

    <cat-field grouped>
      <cat-checkbox
        v-model="frequencyOverEnabled"
        label="Avg. Frequency >"
      />
      <div class="cal-input-width-80">
        <cat-input
          v-model="frequencyOver"
          type="number"
          min="0"
          :disabled="!frequencyOverEnabled"
        />
      </div>
      <div>
        minutes
      </div>
    </cat-field>

    <cat-field>
      <cat-checkbox
        v-model="calculateFrequencyMode"
        label="Calculate frequency based on single routes"
        :disabled="true"
      />
    </cat-field>

    <p class="menu-label">
      <cat-tooltip text="Apportions census data to the area within this radius of each stop. Used in the Stops, Routes, Agencies, and Aggregation tables. Set to 0 to disable.">
        Stop statistical radius
        <cat-icon icon="information" />
      </cat-tooltip>
    </p>
    <cat-field>
      <div class="level">
        <div class="level-item">
          <cat-slider
            v-model="stopBufferRadius"
            :min="0"
            :max="1600"
          />
        </div>
        <div class="level-right">
          <div class="ml-4 level-item">
            <div class="cal-input-width-100">
              <cat-input
                v-model="stopBufferRadius"
                type="number"
                min="0"
              />
            </div>
            <div class="ml-2">
              m
            </div>
          </div>
        </div>
      </div>
    </cat-field>

    <cat-field v-if="stopBufferRadius > 0">
      <template #label>
        <cat-tooltip text="Census layer used for buffer intersections. Tract is the default; finer layers (block group) give more precise apportionment when loaded on the backend. Switching layers triggers a buffer-only refetch — the scenario stays loaded.">
          Buffer layer
          <cat-icon icon="information" />
        </cat-tooltip>
      </template>
      <cat-select v-model="stopBufferLayer">
        <option
          v-for="option of props.censusGeographyLayerOptions"
          :key="option.value"
          :value="option.value"
          :disabled="!HIERARCHICAL_TIGER_LAYERS.has(option.value)"
        >
          {{ option.label }}{{ HIERARCHICAL_TIGER_LAYERS.has(option.value) ? '' : ' (not supported)' }}
        </option>
      </cat-select>
    </cat-field>

    <p class="menu-label">
      <cat-tooltip text="Finds clusters of nearby stops served by different agencies — potential transfer hubs. Max distance is the largest gap (meters) between stops in a cluster. The optional transfer-time filter further requires each stop to have a departure within that many minutes of another stop in the cluster. Changing the distance triggers a cluster-only refetch — the scenario stays loaded; changing the transfer time re-filters instantly.">
        Stop Clustering
        <cat-icon icon="information" />
      </cat-tooltip>
    </p>
    <cat-field>
      <cat-checkbox
        v-model="clusterEnabled"
        label="Cluster nearby stops across agencies"
      />
    </cat-field>
    <p class="cal-cluster-sublabel">
      Max distance
    </p>
    <cat-field>
      <div class="level">
        <div class="level-item">
          <cat-slider
            v-model="clusterDistance"
            :min="0"
            :max="300"
            :disabled="!clusterEnabled"
          />
        </div>
        <div class="level-right">
          <div class="ml-4 level-item">
            <div class="cal-input-width-100">
              <cat-input
                v-model="clusterDistance"
                type="number"
                min="0"
                :disabled="!clusterEnabled"
              />
            </div>
            <div class="ml-2">
              m
            </div>
          </div>
        </div>
      </div>
    </cat-field>
    <cat-field>
      <cat-checkbox
        v-model="clusterTransferEnabled"
        label="Filter by transfer time"
        :disabled="!clusterEnabled || !departuresLoaded"
      />
    </cat-field>
    <p class="cal-cluster-sublabel">
      Max transfer time
    </p>
    <cat-field>
      <div class="level">
        <div class="level-item">
          <cat-slider
            v-model="clusterMaxTransferMinutes"
            :min="0"
            :max="120"
            :disabled="!clusterEnabled || !clusterTransferEnabled || !departuresLoaded"
          />
        </div>
        <div class="level-right">
          <div class="ml-4 level-item">
            <div class="cal-input-width-100">
              <cat-input
                v-model="clusterMaxTransferMinutes"
                type="number"
                min="0"
                :disabled="!clusterEnabled || !clusterTransferEnabled || !departuresLoaded"
              />
            </div>
            <div class="ml-2">
              min
            </div>
          </div>
        </div>
      </div>
    </cat-field>

    <p class="menu-label">
      Fares <cat-tooltip text="Fare filtering is planned for future implementation">
        <i class="mdi mdi-information-outline" />
      </cat-tooltip>
    </p>

    <cat-field grouped>
      <cat-checkbox
        v-model="maxFareEnabled"
        label="Maximum fare $"
        :disabled="true"
      />
      <div class="cal-input-width-100">
        <cat-input
          v-model="maxFare"
          type="number"
          min="0"
          step="0.01"
          :disabled="true"
        />
      </div>
    </cat-field>

    <cat-field grouped>
      <cat-checkbox
        v-model="minFareEnabled"
        label="Minimum fare $"
        :disabled="true"
      />
      <div class="cal-input-width-100">
        <cat-input
          v-model="minFare"
          type="number"
          min="0"
          step="0.01"
          :disabled="true"
        />
      </div>
    </cat-field>
    <cat-fieldset label="Color by">
      <ul>
        <li
          v-for="dataDisplayModeOption of dataDisplayModes"
          :key="dataDisplayModeOption"
        >
          <cat-radio
            v-model="dataDisplayMode"
            :native-value="dataDisplayModeOption"
          >
            {{ dataDisplayModeOption }}
          </cat-radio>
        </li>
      </ul>
    </cat-fieldset>
  </aside>
</template>

<script setup lang="ts">
import {
  dataDisplayModes,
  HIERARCHICAL_TIGER_LAYERS,
  STOP_CLUSTER_DEFAULT_DISTANCE,
  STOP_CLUSTER_DEFAULT_MAX_TRANSFER_MINUTES,
} from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'

const props = defineProps<{
  scenarioFilterResult?: ScenarioFilterResult
  censusGeographyLayerOptions?: { label: string, value: string }[]
}>()

const { dataDisplayMode } = useScenarioDisplay()
const {
  stopBufferRadius,
  stopBufferLayer,
  clusterDistance,
} = useScenarioInputs()
const {
  frequencyUnder,
  frequencyOver,
  calculateFrequencyMode,
  maxFareEnabled,
  maxFare,
  minFareEnabled,
  minFare,
  clusterMaxTransferMinutes,
} = useScenarioFilters()

// Derived checkbox state: checked when value is defined, unchecked sets to undefined
const frequencyUnderEnabled = computed({
  get: () => frequencyUnder.value != null,
  set: (checked: boolean) => { frequencyUnder.value = checked ? 15 : undefined }
})
const frequencyOverEnabled = computed({
  get: () => frequencyOver.value != null,
  set: (checked: boolean) => { frequencyOver.value = checked ? 15 : undefined }
})
// clustering enable derives from distance (0 = off); checking seeds the default.
const clusterEnabled = computed({
  get: () => clusterDistance.value > 0,
  set: (checked: boolean) => { clusterDistance.value = checked ? STOP_CLUSTER_DEFAULT_DISTANCE : 0 }
})
// optional prune enable derives from the transfer minutes (0 = off); checking seeds the default.
const clusterTransferEnabled = computed({
  get: () => clusterMaxTransferMinutes.value > 0,
  set: (checked: boolean) => { clusterMaxTransferMinutes.value = checked ? STOP_CLUSTER_DEFAULT_MAX_TRANSFER_MINUTES : 0 }
})
// The prune needs loaded departures; without them the transfer option has nothing
// to apply, so it's disabled until a query with departures runs.
const departuresLoaded = computed(() => {
  const cache = props.scenarioFilterResult?.stopDepartureCache
  return cache != null && !cache.isEmpty()
})
</script>

<style scoped lang="scss">
.cal-service-levels {
  .cal-input-width-80 {
    max-width: 80px;
  }
  .cal-input-width-100 {
    max-width: 100px;
  }
}

// sub-label for the Max distance / transfer controls under Stop Clustering.
.cal-cluster-sublabel {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
</style>
