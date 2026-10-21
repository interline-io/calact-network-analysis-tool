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

    <cat-fieldset label="Connections and grades">
      <cat-checkbox :model-value="settings.allConnections" @update:model-value="set({ allConnections: !!$event })">
        <cat-tooltip text="By default, each arrival shows its first connection on each route and direction, and any it just missed." position="right">
          Show every connection
        </cat-tooltip>
      </cat-checkbox>
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
        Minutes of wait. A wait below the first, or above the last, is not a
        transfer.
        <button type="button" class="cal-transfer-settings-link" @click="set({ breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] })">
          Reset
        </button>
      </p>
    </cat-fieldset>

    <cat-fieldset label="Routes and headsigns">
      <div class="cal-transfer-settings-sides">
        <div v-for="side of sides" :key="side.key" role="group" :aria-label="`${side.legend} routes`">
          <div class="cal-transfer-settings-route-actions">
            <span>{{ side.legend }}</span>
            <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: [] })">
              All
            </button>
            <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: side.routes.flatMap(r => r.headsigns.map(h => h.key)) })">
              None
            </button>
          </div>
          <!-- A route, checked when all its headsigns are, and its headsigns
               below it once opened. -->
          <ul class="cal-transfer-settings-tree">
            <li v-for="route of side.routes" :key="route.id">
              <div class="cal-transfer-settings-tree-route">
                <button
                  type="button"
                  class="cal-transfer-settings-tree-toggle"
                  :aria-expanded="isOpen(side.key, route.id)"
                  :aria-label="`${isOpen(side.key, route.id) ? 'Hide' : 'Show'} headsigns for ${route.label}`"
                  @click="toggleOpen(side.key, route.id)"
                >
                  <cat-icon size="small" :icon="isOpen(side.key, route.id) ? 'chevron-down' : 'chevron-right'" />
                </button>
                <cat-checkbox
                  :model-value="routeState(side.key, route) !== 'none'"
                  :indeterminate="routeState(side.key, route) === 'some'"
                  @update:model-value="setHeadsigns(side.key, route.headsigns.map(h => h.key), !!$event)"
                >
                  <cal-route-badge :label="route.label" :color="route.color" :text-color="route.textColor" :title="route.longName" />
                </cat-checkbox>
              </div>
              <ul v-if="isOpen(side.key, route.id)" class="cal-transfer-settings-tree-headsigns">
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
        </div>
      </div>
    </cat-fieldset>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFAULT_TRANSFER_SETTINGS, validBreakpoints, type TransferRouteChoice, type TransferSettings } from '~~/src/scenario'

const props = defineProps<{
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

type Side = 'excludedFrom' | 'excludedTo'

const sides = computed(() => [
  { key: 'excludedFrom' as const, legend: 'Arriving', routes: props.routeChoices.from },
  { key: 'excludedTo' as const, legend: 'Departing', routes: props.routeChoices.to },
])

// Routes opened to show their headsigns, by side and route id.
const opened = ref(new Set<string>())
function isOpen (side: Side, routeId: number): boolean {
  return opened.value.has(`${side}|${routeId}`)
}
function toggleOpen (side: Side, routeId: number) {
  const key = `${side}|${routeId}`
  const next = new Set(opened.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  opened.value = next
}

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
// The settings side by side, wrapping on narrow screens.
.cal-transfer-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.75rem;
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
  max-width: 18rem;
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

.cal-transfer-settings-sides {
  display: flex;
  gap: 1.25rem;
}

.cal-transfer-settings-route-actions {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;

  span {
    font-weight: 600;
  }
}

.cal-transfer-settings-tree {
  max-height: 7.5rem;
  overflow-y: auto;
  min-width: 13rem;
  margin: 0;
  list-style: none;
}

.cal-transfer-settings-tree-route {
  display: flex;
  align-items: center;
}

.cal-transfer-settings-tree-toggle {
  background: none;
  border: 0;
  padding: 0;
  width: 1.25rem;
  color: var(--bulma-text-weak);
  cursor: pointer;
}

.cal-transfer-settings-tree-headsigns {
  margin: 0 0 0.25rem 1.75rem;
  list-style: none;
  font-size: 0.75rem;
}

.cal-transfer-settings-count {
  color: var(--bulma-text-weak);
  font-variant-numeric: tabular-nums;
}
</style>
