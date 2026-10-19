<template>
  <aside class="menu">
    <cat-notification
      variant="warning"
    >
      <span>
        Flex service data may be incomplete. Please contact relevant agencies for additional information.
      </span>
    </cat-notification>

    <div :class="{ 'is-disabled': !flexServicesEnabled }">
      <p class="menu-label">
        Advance notice
      </p>
      <cat-checkbox-group
        v-model="flexAdvanceNotice"
        :options="[...flexAdvanceNoticeTypes]"
        :disabled="!flexServicesEnabled"
      />

      <p class="menu-label">
        Show areas that allow:
      </p>
      <cat-checkbox-group
        v-model="flexAreaTypesSelected"
        :options="[...flexAreaTypes]"
        :disabled="!flexServicesEnabled"
      />

      <p class="menu-label">
        <cat-tooltip :text="flexRiderEligibilityDescription">
          Rider eligibility
          <cat-icon icon="information" />
        </cat-tooltip>
      </p>
      <cat-checkbox-group
        v-model="flexRiderEligibility"
        :options="[...flexRiderEligibilityTypes]"
        :disabled="!flexServicesEnabled"
      />

      <cat-fieldset label="Color by" :disabled="!flexServicesEnabled">
        <ul>
          <li
            v-for="colorMode of flexColorByModes"
            :key="colorMode"
          >
            <cat-radio
              v-model="flexColorBy"
              :native-value="colorMode"
              :disabled="!flexServicesEnabled"
            >
              {{ colorMode }}
            </cat-radio>
          </li>
        </ul>
      </cat-fieldset>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {
  flexAdvanceNoticeTypes,
  flexAreaTypes,
  flexColorByModes,
  flexRiderEligibilityDescription,
  flexRiderEligibilityTypes,
} from '~~/src/core'

const {
  flexServicesEnabled,
  flexAdvanceNotice,
  flexAreaTypesSelected,
  flexRiderEligibility,
  flexColorBy,
} = useScenarioFilters()
</script>

<style scoped lang="scss">
.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
