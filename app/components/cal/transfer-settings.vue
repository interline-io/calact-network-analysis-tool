<template>
  <section class="cal-transfer-settings" aria-label="Transfer settings">
    <cat-fieldset label="Walking between stops">
      <cat-field v-for="o of walkOptions" :key="o.value">
        <cat-radio
          :model-value="settings.walkDistance"
          :native-value="o.value"
          :disabled="o.disabled"
          @update:model-value="set({ walkDistance: $event as TransferSettings['walkDistance'] })"
        >
          <cat-tooltip :text="o.tooltip" position="right">
            {{ o.label }}
          </cat-tooltip>
        </cat-radio>
      </cat-field>
      <label class="cal-transfer-settings-inline">
        Seconds per meter
        <cat-input
          :model-value="settings.secondsPerMeter"
          :model-modifiers="{ lazy: true }"
          type="number"
          min="0.1"
          step="0.1"
          size="small"
          v-bind="{ ariaLabel: 'Walking seconds per meter' }"
          @update:model-value="set({ secondsPerMeter: Number($event) })"
        />
      </label>
      <p class="cal-transfer-settings-help">
        Walking time is the distance times this: {{ pace }}. None at the same stop.
      </p>
      <p v-if="unknownPairs > 0" class="cal-transfer-settings-warning">
        No distance for {{ unknownPairs }} {{ unknownPairs === 1 ? 'pair' : 'pairs' }} of stops; transfers between them are left out.
      </p>
    </cat-fieldset>

    <cat-fieldset label="Connections">
      <cat-checkbox :model-value="settings.allConnections" @update:model-value="set({ allConnections: !!$event })">
        Show every connection
      </cat-checkbox>
      <p class="cal-transfer-settings-help">
        By default, each arrival shows its first connection on each route and
        direction, and any it just missed.
      </p>
    </cat-fieldset>

    <cat-fieldset label="Grades (minutes of wait)">
      <div class="cal-transfer-settings-grades">
        <label v-for="(b, i) of gradeBounds" :key="b.label" class="cal-transfer-settings-grade">
          <span>{{ b.label }}</span>
          <cat-input
            :model-value="minutes(settings.breakpoints[i])"
            :model-modifiers="{ lazy: true }"
            type="number"
            step="0.5"
            size="small"
            v-bind="{ ariaLabel: `${b.label}, in minutes` }"
            @update:model-value="setBreakpoint(i, Number($event))"
          />
        </label>
      </div>
      <p v-if="!breakpointsValid" class="cal-transfer-settings-warning">
        Each must be more than the one before; the defaults apply until then.
      </p>
      <p class="cal-transfer-settings-help">
        A wait below the first, or above the last, is not a transfer.
        <button type="button" class="cal-transfer-settings-link" @click="set({ breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] })">
          Reset
        </button>
      </p>
    </cat-fieldset>

    <cat-fieldset v-for="side of sides" :key="side.key" :label="side.legend">
      <div class="cal-transfer-settings-route-actions">
        <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: [] })">
          All
        </button>
        <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: side.routes.map(r => r.id) })">
          None
        </button>
      </div>
      <div class="cal-transfer-settings-routes">
        <cat-checkbox
          v-for="route of side.routes"
          :key="route.id"
          :model-value="!settings[side.key].includes(route.id)"
          @update:model-value="toggleRoute(side.key, route.id, !!$event)"
        >
          <cal-route-badge :label="route.label" :color="route.color" :text-color="route.textColor" :title="route.longName" />
        </cat-checkbox>
      </div>
    </cat-fieldset>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_TRANSFER_SETTINGS, validBreakpoints, type TransferSettings } from '~~/src/scenario'

interface RouteChoice {
  id: number
  label: string
  longName: string
  color: string
  textColor: string
}

const props = defineProps<{
  // The routes arriving and departing at the stops.
  routeChoices: { from: RouteChoice[], to: RouteChoice[] }
  // Pairs of the stops with no distance between them.
  unknownPairs: number
}>()

const settings = defineModel<TransferSettings>({ required: true })

function set (change: Partial<TransferSettings>) {
  settings.value = { ...settings.value, ...change }
}

const walkOptions: { value: TransferSettings['walkDistance'], label: string, tooltip: string, disabled?: boolean }[] = [
  { value: 'line', label: 'Straight line', tooltip: 'The straight-line distance between the stops.' },
  { value: 'street', label: 'Street network', tooltip: 'The distance along streets and paths, from OpenStreetMap; a straight line where no route is found.' },
  { value: 'pathways', label: 'GTFS-Pathways', tooltip: 'Coming later: walks through stations along the paths, stairs, and elevators their feeds publish.', disabled: true },
]

// 1 second per meter is 3.6 km/h.
const pace = computed(() => {
  const spm = settings.value.secondsPerMeter
  if (!(spm > 0)) {
    return 'no walk'
  }
  const kmh = 3.6 / spm
  return `${kmh.toFixed(1)} km/h (${(kmh / 1.609344).toFixed(1)} mph)`
})

const gradeBounds = [
  { label: 'Missed from' },
  { label: 'Good from' },
  { label: 'OK from' },
  { label: 'Long wait from' },
  { label: 'Up to' },
]

function minutes (seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds / 60
}

function setBreakpoint (index: number, mins: number) {
  const breakpoints = [...settings.value.breakpoints]
  breakpoints[index] = mins * 60
  set({ breakpoints })
}

const breakpointsValid = computed(() => validBreakpoints(settings.value.breakpoints))

const sides = computed(() => [
  { key: 'excludedFromRoutes' as const, legend: 'Arriving routes', routes: props.routeChoices.from },
  { key: 'excludedToRoutes' as const, legend: 'Departing routes', routes: props.routeChoices.to },
])

function toggleRoute (key: 'excludedFromRoutes' | 'excludedToRoutes', routeId: number, included: boolean) {
  const excluded = new Set(settings.value[key])
  if (included) {
    excluded.delete(routeId)
  } else {
    excluded.add(routeId)
  }
  set({ [key]: [...excluded] })
}
</script>

<style scoped lang="scss">
// The settings side by side, wrapping on narrow screens.
.cal-transfer-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 2rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  font-size: 0.875rem;
  flex: 0 0 auto;

  > * {
    flex: 0 1 auto;
    margin-bottom: 0;
  }

  :deep(.field) {
    margin-bottom: 0.25rem;
  }
}

.cal-transfer-settings-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;

  :deep(input) {
    width: 5rem;
  }
}

.cal-transfer-settings-grades {
  display: flex;
  gap: 0.5rem;
}

.cal-transfer-settings-grade {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;

  :deep(input) {
    width: 4.5rem;
  }
}

.cal-transfer-settings-help {
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
  margin-top: 0.25rem;
  max-width: 22rem;
}

.cal-transfer-settings-warning {
  color: var(--bulma-warning-on-scheme, var(--bulma-text-strong));
  font-size: 0.75rem;
  margin-top: 0.25rem;
  max-width: 22rem;
}

.cal-transfer-settings-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--bulma-link);
  cursor: pointer;
  text-decoration: underline;
}

.cal-transfer-settings-route-actions {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.cal-transfer-settings-routes {
  display: flex;
  flex-direction: column;
  max-height: 9rem;
  overflow-y: auto;
  min-width: 10rem;
}
</style>
