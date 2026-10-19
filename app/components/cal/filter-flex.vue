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
        :options="flexAdvanceNoticeTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
      />

      <p class="menu-label">
        Show areas that allow:
      </p>
      <cat-checkbox-group
        v-model="flexAreaTypesSelected"
        :options="flexAreaTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
      />

      <p class="menu-label">
        <cat-tooltip text="Eligibility restricted services carry only riders enrolled in or eligible for a specific program, such as ADA paratransit or Medicaid transportation. This comes from a feed tag in Transitland Atlas; areas from untagged feeds count as General public.">
          Rider eligibility
          <cat-icon icon="information" />
        </cat-tooltip>
      </p>
      <cat-checkbox-group
        v-model="flexRiderEligibility"
        :options="flexRiderEligibilityTypes.map(t => ({ value: t, label: t, disabled: !flexServicesEnabled }))"
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
