<template>
  <aside class="menu">
    <cat-fieldset class="mb-4">
      <template #label>
        <cat-tooltip text="Keeps routes and flex service areas by their standard single-ride fare: the feed's default rider category in GTFS Fares v2, or the published fare in Fares v1. A flex area takes the fares of the routes serving it. Many agencies publish no fares, so keep Unknown fare selected to avoid hiding them.">
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
    <p class="cal-filter-fares-note">
      Routes and areas whose fares have not loaded are hidden while a fare category is unchecked.
    </p>
  </aside>
</template>

<script setup lang="ts">
import { FARE_CATEGORIES, fareCategoryDescriptions, fareCategoryLabels, type FareCategory } from '~~/src/tl'

const { selectedFareCategories } = useScenarioFilters()

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
.cal-filter-fares-note {
  font-size: 0.85rem;
  color: var(--bulma-text-weak);
}
</style>
