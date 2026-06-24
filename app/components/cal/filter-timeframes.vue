<template>
  <cat-fieldset label="Days of the week" class="cal-filter-days block">
    <section class="cal-day-of-week-mode menu-list">
      <cat-field>
        <cat-radio
          v-model="selectedWeekdayMode"
          name="selectedWeekdayMode"
          native-value="Any"
          label="Any of the following days"
        />
      </cat-field>
      <cat-field>
        <cat-radio
          v-model="selectedWeekdayMode"
          name="selectedWeekdayMode"
          native-value="All"
          label="All of the following days"
        />
      </cat-field>
    </section>
    <cat-checkbox-group
      v-model="selectedWeekdays"
      :options="dowValues.map(d => ({ value: d, label: titleCase(d), disabled: !dowAvailable.has(d) }))"
    />
  </cat-fieldset>

  <cat-fieldset class="cal-filter-times block">
    <template #label>
      Time of Day
      <cat-tooltip
        text="Fixed-route transit: Filters to show only departures within the selected time window. Flex service areas: Filters to show only areas with service windows that overlap with the selected time range."
        position="left"
      >
        <i class="mdi mdi-information-outline" />
      </cat-tooltip>
    </template>

    <cat-field class="cal-time-of-day-mode">
      <cat-checkbox
        v-model="isAllDayMode"
        label="All Day"
      />
    </cat-field>

    <p class="menu-label">
      Starting
    </p>

    <cat-field>
      <cal-timepicker
        ref="startTimeRef"
        v-model="startTime"
        size="small"
        icon="clock"
        :disabled="isAllDayMode"
      />
    </cat-field>

    <p class="menu-label">
      Ending
    </p>

    <cat-field>
      <cal-timepicker
        v-model="endTime"
        size="small"
        icon="clock"
        :disabled="isAllDayMode"
      />
    </cat-field>
  </cat-fieldset>
</template>

<script setup lang="ts">
import { eachDayOfInterval } from 'date-fns'
import {
  type Weekday,
  dowValues,
  parseTime,
  DEFAULT_TIME_WINDOW,
} from '~~/src/core'

const { startDate, endDate } = useScenarioInputs()
const {
  startTime,
  endTime,
  selectedWeekdayMode,
  selectedWeekdays,
  setTimeRange,
} = useScenarioFilters()

// Derived checkbox state: checked (All Day) when both times are undefined, unchecked sets default times
const isAllDayMode = computed({
  get: () => startTime.value == null && endTime.value == null,
  set: (checked: boolean) => {
    if (checked) {
      setTimeRange(undefined, undefined)
    } else {
      setTimeRange(parseTime(DEFAULT_TIME_WINDOW.start), parseTime(DEFAULT_TIME_WINDOW.end))
    }
  }
})

const dowAvailable = computed((): Set<string> => {
  // JavaScript day of week starts on Sunday, this is different from dowValues
  const jsDowValues: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const result = new Set<string>()
  const range = eachDayOfInterval({ start: startDate.value, end: endDate.value })
  for (const d of range) {
    const dow = jsDowValues[d.getDay()]
    if (dow) {
      result.add(dow)
    }
    if (result.size === 7) { break } // we got them all
  }
  return result
})

function titleCase (s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

///////////////////
// Time of Day focus management

const startTimeRef = ref<{ focus: () => void } | null>(null)

// When the user disables "All Day", move focus to the newly enabled start time
// picker so keyboard users can begin editing without hunting for it.
watch(isAllDayMode, async (allDay, prevAllDay) => {
  if (prevAllDay && !allDay) {
    await nextTick()
    startTimeRef.value?.focus()
  }
})
</script>

<style scoped lang="scss">
.cal-day-of-week-mode {
  margin-left: 20px;
  margin-bottom: 15px;
}
</style>
