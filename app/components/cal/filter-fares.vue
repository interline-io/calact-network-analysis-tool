<template>
  <aside class="menu">
    <cat-fieldset class="mb-4">
      <template #label>
        <cat-tooltip text="Keeps routes and flex service areas by their standard single-ride fare: the feed's default rider category in GTFS Fares v2, or the published fare in Fares v1. A flex area takes the fares of the routes serving it. A fare offered only on certain dates, such as a holiday fare, counts only if it applies in the query's date range. Many agencies publish no fares, so keep Unknown fare selected to avoid hiding them.">
          Fare category
          <cat-icon icon="information" />
        </cat-tooltip>
      </template>
      <cat-field
        v-for="category of FARE_CATEGORIES"
        :key="category"
      >
        <cat-checkbox
          v-model="localSelectedFareCategories"
          :native-value="category"
        >
          <cat-tooltip :text="fareCategoryDescriptions[category]" position="right">
            {{ fareCategoryLabels[category] }}
          </cat-tooltip>
        </cat-checkbox>
      </cat-field>
    </cat-fieldset>
    <cat-fieldset class="mb-4">
      <template #label>
        <cat-tooltip text="Keeps routes and flex areas whose every standard single-ride fare is within the amount, so a route with a range of fares (zones, free directions) passes only if the whole range does. Routes with an unknown fare are not tested here; the Unknown fare checkbox decides whether they are kept.">
          Fare amount
          <cat-icon icon="information" />
        </cat-tooltip>
      </template>

      <cat-field grouped>
        <cat-checkbox
          v-model="fareMaxEnabled"
          label="Fare at most"
        />
        <div class="cal-filter-fares-input">
          <cat-input
            :model-value="fareMax"
            optional
            type="number"
            min="0"
            step="0.25"
            prefix="$"
            :decimals="2"
            v-bind="{ ariaLabel: 'Maximum fare in dollars' }"
            :disabled="!fareMaxEnabled"
            @update:model-value="setFareMax"
          />
        </div>
      </cat-field>

      <cat-field grouped>
        <cat-checkbox
          v-model="fareMinEnabled"
          label="Fare at least"
        />
        <div class="cal-filter-fares-input">
          <cat-input
            :model-value="fareMin"
            optional
            type="number"
            min="0"
            step="0.25"
            prefix="$"
            :decimals="2"
            v-bind="{ ariaLabel: 'Minimum fare in dollars' }"
            :disabled="!fareMinEnabled"
            @update:model-value="setFareMin"
          />
        </div>
      </cat-field>
    </cat-fieldset>
  </aside>
</template>

<script setup lang="ts">
import { FARE_MAX_DEFAULT, FARE_MIN_DEFAULT } from '~~/src/core'
import { FARE_CATEGORIES, fareCategoryDescriptions, fareCategoryLabels, type FareCategory } from '~~/src/tl'

const { selectedFareCategories, fareMax, fareMin } = useScenarioFilters()
const setFareMax = keepValueWhenEmptied(fareMax)
const setFareMin = keepValueWhenEmptied(fareMin)

// Checked when the amount is set; checking seeds a default, unchecking clears it.
const fareMaxEnabled = computed({
  get: () => fareMax.value != null,
  set: (checked: boolean) => { fareMax.value = checked ? FARE_MAX_DEFAULT : undefined }
})
const fareMinEnabled = computed({
  get: () => fareMin.value != null,
  set: (checked: boolean) => { fareMin.value = checked ? FARE_MIN_DEFAULT : undefined }
})

// Checkbox binding: undefined (no filter) shows every category ticked, and
// ticking all four goes back to undefined.
const localSelectedFareCategories = computed<FareCategory[]>({
  get: () => selectedFareCategories.value ?? [...FARE_CATEGORIES],
  set: (v: FareCategory[]) => {
    const all = FARE_CATEGORIES.every(c => v.includes(c))
    selectedFareCategories.value = all ? undefined : FARE_CATEGORIES.filter(c => v.includes(c))
  }
})
</script>

<style scoped lang="scss">
// The input with its "$" prefix addon.
.cal-filter-fares-input {
  max-width: 120px;
}
</style>
