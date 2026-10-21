<template>
  <section
    class="cal-transfer-settings"
    :class="section === 'trips' ? 'is-trips' : 'is-wait-walk'"
    :aria-label="section === 'trips' ? 'Trip filtering' : 'Wait and walking settings'"
  >
    <template v-if="section === 'wait-walk'">
      <cat-fieldset label="Walking between stops">
        <div class="cal-transfer-settings-row">
          <cat-radio
            v-for="o of walkOptions"
            :key="o.value"
            :model-value="settings.walkDistance"
            :native-value="o.value"
            :disabled="o.disabled"
            @update:model-value="set({ walkDistance: $event as TransferSettings['walkDistance'] })"
          >
            <cat-tooltip :text="o.tooltip">
              {{ o.label }}
            </cat-tooltip>
          </cat-radio>
        </div>
        <label class="cal-transfer-settings-row">
          Seconds per meter
          <cat-input
            :model-value="settings.secondsPerMeter"
            :model-modifiers="{ lazy: true }"
            type="number"
            min="0.1"
            step="0.1"
            size="small"
            class="cal-transfer-settings-number"
            v-bind="{ ariaLabel: 'Walking seconds per meter' }"
            @update:model-value="set({ secondsPerMeter: Number($event) })"
          />
          <span class="cal-transfer-settings-help">{{ pace }}; no walk at the same stop</span>
        </label>
        <p v-if="unknownPairs > 0" class="cal-transfer-settings-warning">
          No distance for {{ unknownPairs }} {{ unknownPairs === 1 ? 'pair' : 'pairs' }} of stops; transfers between them are left out.
        </p>
      </cat-fieldset>

      <!-- The grades as a scale: each between the two waits, in minutes, that
           bound it, in its color. -->
      <cat-fieldset label="Grades (minutes of wait)">
        <div class="cal-transfer-settings-scale">
          <template v-for="(bound, i) of bounds" :key="bound">
            <cat-input
              :model-value="minutes(settings.breakpoints[i])"
              :model-modifiers="{ lazy: true }"
              type="number"
              step="0.5"
              size="small"
              class="cal-transfer-settings-number"
              v-bind="{ ariaLabel: `${bound}, in minutes` }"
              @update:model-value="setBreakpoint(i, Number($event))"
            />
            <span
              v-if="grades[i]"
              class="cal-transfer-settings-grade"
              :style="{ background: TRANSFER_GRADE_COLORS[grades[i]!].fill, color: TRANSFER_GRADE_COLORS[grades[i]!].text }"
            >{{ TRANSFER_GRADE_LABELS[grades[i]!] }}</span>
          </template>
        </div>
        <p class="cal-transfer-settings-help">
          <template v-if="!breakpointsValid">
            <span class="cal-transfer-settings-warning">Each must be more than the one before; the defaults apply until then.</span>
          </template>
          <template v-else>
            A wait below the first, or above the last, is not a transfer.
          </template>
          <button type="button" class="cal-transfer-settings-link" @click="set({ breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] })">
            Reset
          </button>
        </p>
      </cat-fieldset>

      <cat-fieldset label="Connections">
        <cat-checkbox :model-value="settings.allConnections" @update:model-value="set({ allConnections: !!$event })">
          Show every connection
        </cat-checkbox>
        <p class="cal-transfer-settings-help">
          Otherwise each arrival shows its first connection on each route and
          direction, and any it just missed.
        </p>
      </cat-fieldset>
    </template>

    <!-- Arriving and departing trips side by side; each route with its
         headsigns beneath, the routes in a grid that fills the width. -->
    <template v-else>
      <cat-fieldset v-for="side of sides" :key="side.key" :label="`${side.legend} routes and headsigns`">
        <div class="cal-transfer-settings-route-actions">
          <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: [] })">
            All
          </button>
          <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: side.routes.flatMap(r => r.headsigns.map(h => h.key)) })">
            None
          </button>
        </div>
        <ul class="cal-transfer-settings-routes">
          <li v-for="route of side.routes" :key="route.id" class="cal-transfer-settings-route">
            <cat-checkbox
              :model-value="routeState(side.key, route) !== 'none'"
              :indeterminate="routeState(side.key, route) === 'some'"
              @update:model-value="setHeadsigns(side.key, route.headsigns.map(h => h.key), !!$event)"
            >
              <cal-route-badge :label="route.label" :title="route.longName || route.label" truncate />
              <span v-if="route.longName && route.longName !== route.label" class="cal-transfer-settings-long-name">{{ route.longName }}</span>
            </cat-checkbox>
            <ul class="cal-transfer-settings-headsigns">
              <li v-for="h of route.headsigns" :key="h.key">
                <cat-checkbox
                  :model-value="!settings[side.key].includes(h.key)"
                  @update:model-value="setHeadsigns(side.key, [h.key], !!$event)"
                >
                  {{ h.label }} <span class="cal-transfer-settings-count">{{ h.count.toLocaleString() }}</span>
                </cat-checkbox>
              </li>
            </ul>
          </li>
        </ul>
      </cat-fieldset>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  DEFAULT_TRANSFER_SETTINGS,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  validBreakpoints,
  type TransferRouteChoice,
  type TransferSettings,
} from '~~/src/scenario'

export type TransferSettingsSection = 'wait-walk' | 'trips'

const props = defineProps<{
  // Which settings to show: waits and walking, or the trips to include.
  section: TransferSettingsSection
  // The routes arriving and departing at the stops.
  routeChoices: { from: TransferRouteChoice[], to: TransferRouteChoice[] }
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

// The five breakpoints, by what each starts or ends, and the grades between.
const bounds = ['Missed from', 'Good from', 'OK from', 'Long wait from', 'Long wait up to']
const grades = TRANSFER_GRADES

function minutes (seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds / 60
}

function setBreakpoint (index: number, mins: number) {
  const breakpoints = [...settings.value.breakpoints]
  breakpoints[index] = mins * 60
  set({ breakpoints })
}

const breakpointsValid = computed(() => validBreakpoints(settings.value.breakpoints))

type Side = 'excludedFrom' | 'excludedTo'

const sides = computed(() => [
  { key: 'excludedFrom' as const, legend: 'Arriving', routes: props.routeChoices.from },
  { key: 'excludedTo' as const, legend: 'Departing', routes: props.routeChoices.to },
])

// Whether all, some, or none of a route's headsigns are included.
function routeState (side: Side, route: TransferRouteChoice): 'all' | 'some' | 'none' {
  const excluded = new Set(settings.value[side])
  const out = route.headsigns.filter(h => excluded.has(h.key)).length
  return out === 0 ? 'all' : out === route.headsigns.length ? 'none' : 'some'
}

function setHeadsigns (side: Side, keys: string[], included: boolean) {
  const excluded = new Set(settings.value[side])
  for (const key of keys) {
    if (included) {
      excluded.delete(key)
    } else {
      excluded.add(key)
    }
  }
  set({ [side]: [...excluded] })
}
</script>

<style scoped lang="scss">
// The settings across the panel's width, in a grid that wraps on narrow
// screens.
.cal-transfer-settings {
  display: grid;
  gap: 0.75rem 2rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  font-size: 0.875rem;
  flex: 0 0 auto;

  // Walking and the grade scale at their own width; connections, the rest.
  &.is-wait-walk {
    display: flex;
    flex-wrap: wrap;

    > :last-child {
      flex: 1 1 14rem;
    }
  }

  &.is-trips {
    grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
  }

  > * {
    margin-bottom: 0;
    min-width: 0;
  }
}

.cal-transfer-settings-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 1rem;
  margin-bottom: 0.4rem;
}

.cal-transfer-settings-number {
  :deep(input) {
    width: 3.5rem;
  }
}

// Inputs and grade chips alternating on one line.
.cal-transfer-settings-scale {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
}

.cal-transfer-settings-grade {
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.cal-transfer-settings-help {
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
}

.cal-transfer-settings-warning {
  color: var(--bulma-warning-on-scheme, var(--bulma-text-strong));
  font-size: 0.75rem;
}

.cal-transfer-settings-link {
  background: none;
  border: 0;
  padding: 0;
  margin-left: 0.5rem;
  font: inherit;
  color: var(--bulma-link);
  cursor: pointer;
  text-decoration: underline;
}

.cal-transfer-settings-route-actions {
  display: flex;
  font-size: 0.75rem;
  margin-bottom: 0.4rem;

  .cal-transfer-settings-link:first-child {
    margin-left: 0;
  }
}

// Routes in columns that fill the side's width, scrolling past a few rows.
.cal-transfer-settings-routes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.5rem 1rem;
  max-height: 11rem;
  overflow-x: hidden;
  overflow-y: auto;
  margin: 0;
  list-style: none;
}

.cal-transfer-settings-route {
  min-width: 0;

  // A long route name is cut short within its column.
  :deep(.checkbox) {
    max-width: 100%;
  }
}

.cal-transfer-settings-long-name {
  margin-left: 0.35rem;
  font-size: 0.75rem;
  color: var(--bulma-text-weak);
}

.cal-transfer-settings-headsigns {
  margin: 0.1rem 0 0 1.5rem;
  list-style: none;
  font-size: 0.75rem;
}

.cal-transfer-settings-count {
  color: var(--bulma-text-weak);
  font-variant-numeric: tabular-nums;
}
</style>
