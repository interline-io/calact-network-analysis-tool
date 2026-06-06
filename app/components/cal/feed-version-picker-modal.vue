<template>
  <cat-modal
    v-model="modelOpen"
    title="Feed Archive: dates & feed versions"
    full-screen
  >
    <div class="cal-fv-modal-dates">
      <cat-field>
        <template #label>
          <cat-tooltip text="The start date is used to define which week is used to calculate the days-of-week on which a route runs or a stop is served.">
            Start date
            <cat-icon size="small" icon="information" />
          </cat-tooltip>
        </template>
        <cat-datepicker
          v-model="stagedStart"
          :min-date="wideMinDate"
          :max-date="wideMaxDate"
          :years-range="wideYearsRange"
          readonly
        />
      </cat-field>
      <cat-field>
        <template #label>
          End date
        </template>
        <div v-if="!stagedSingleDay" class="cal-fv-modal-end-date">
          <cat-datepicker
            v-model="stagedEnd"
            :min-date="wideMinDate"
            :max-date="wideMaxDate"
            :years-range="wideYearsRange"
            :variant="stagedEndValid ? undefined : 'danger'"
            readonly
          />
          <!-- TODO: catenary >0.3.0 declares aria-label/title as cat-button
               props; on the next bump, replace this v-bind workaround with
               plain attributes. -->
          <cat-button
            icon="close"
            v-bind="{ 'aria-label': 'Remove end date', 'title': 'Remove end date (analyze a single day)' }"
            @click="toggleStagedSingleDay"
          />
        </div>
        <cat-button v-else @click="toggleStagedSingleDay">
          Set an end date
        </cat-button>
        <p v-if="!stagedEndValid" class="help is-danger">
          End date must be on or after the start date.
        </p>
      </cat-field>
      <div class="cal-fv-modal-dates-summary">
        <p>
          Analysis window:
          <strong>{{ windowLabel }}</strong>
          <span v-if="overrideCount > 0"> · {{ overrideCount }} feed version override{{ overrideCount === 1 ? '' : 's' }}</span>
        </p>
        <p class="help">
          The Feed Archive holds every fetched version of each feed. Pin a
          version per feed, exclude feeds, or import an older version to
          analyze historical dates. Drag the highlighted window on a timeline
          to retarget the analysis dates. Changes take effect when you click
          <em>Apply</em>.
        </p>
      </div>
    </div>

    <cal-feed-version-picker
      v-model="stagedFvids"
      :bbox="bbox"
      :analysis-start="stagedStart"
      :analysis-end="stagedEndEffective"
      selectable
      range-editable
      @update:feed-onestop-ids="onFeedList"
      @update:analysis-range="onAnalysisRange"
    />

    <template #footer>
      <div class="cal-fv-modal-actions">
        <span class="cal-fv-modal-count" :class="{ 'is-empty': overrideCount === 0 }">
          {{ overrideCount }} override{{ overrideCount === 1 ? '' : 's' }} staged
        </span>
        <cat-button variant="light" @click="onCancel">
          Cancel
        </cat-button>
        <cat-button variant="light" @click="onReset">
          Reset to defaults
        </cat-button>
        <cat-button variant="light" :disabled="feedOnestopIds.length === 0" @click="onExcludeAll">
          Exclude all
        </cat-button>
        <cat-button variant="primary" :disabled="!stagedEndValid" @click="onApply">
          Apply
        </cat-button>
      </div>
    </template>
  </cat-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CalFeedVersionPicker from '~/components/cal/feed-version-picker.vue'
import { parseFvids, serializeFvids } from '~~/src/tl'
import {
  asDateString,
  defaultEndDate,
  defaultStartDate,
  fmtDate,
  normalizeDate,
  parseDate,
  validEndDate,
  WIDE_DATE_YEARS_BACK,
  WIDE_DATE_YEARS_FORWARD,
  wideMaxAllowedDate,
  wideMinAllowedDate,
  type Bbox,
} from '~~/src/core'

const props = withDefaults(defineProps<{
  open: boolean
  // Committed values — staged copies are taken when the modal opens and only
  // pushed back (atomically, via the apply event) when the user clicks Apply.
  startDate: Date
  endDate: Date
  fvids?: string
  bbox: Bbox
}>(), {
  fvids: '',
})

interface FeedVersionModalApplyPayload {
  startDate: Date
  endDate: Date
  fvids: string
  singleDay: boolean
}

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'apply', value: FeedVersionModalApplyPayload): void
}>()

const modelOpen = computed<boolean>({
  get: () => props.open,
  set: (v) => { emit('update:open', v) }
})

// Much wider than the Query panel's inline pickers — historical dates are
// the whole point of picking/importing older feed versions.
const wideMinDate = wideMinAllowedDate()
const wideMaxDate = wideMaxAllowedDate()
const wideYearsRange: [number, number] = [-WIDE_DATE_YEARS_BACK, WIDE_DATE_YEARS_FORWARD]

// Staged so Cancel discards in-modal edits. Reset on each open below.
const stagedStart = ref<Date>(props.startDate)
const stagedEnd = ref<Date>(props.endDate)
// Single-day mode is derived from the committed dates rather than tracked as
// separate state: it simply means "end date equals start date".
const stagedSingleDay = ref<boolean>(false)
const stagedFvids = ref<string>(props.fvids)
const feedOnestopIds = ref<string[]>([])

watch(() => props.open, (open) => {
  if (open) {
    stagedStart.value = props.startDate
    stagedEnd.value = props.endDate
    stagedSingleDay.value = asDateString(props.startDate) === asDateString(props.endDate)
    stagedFvids.value = props.fvids
  }
})

const stagedEndEffective = computed<Date>(() =>
  stagedSingleDay.value ? stagedStart.value : stagedEnd.value)

const stagedEndValid = computed(() => validEndDate(stagedStart.value, stagedEnd.value, stagedSingleDay.value))

const windowLabel = computed(() => {
  const s = fmtDate(stagedStart.value, 'MMM d, yyyy')
  if (stagedSingleDay.value) { return s }
  return `${s} – ${fmtDate(stagedEndEffective.value, 'MMM d, yyyy')}`
})

function toggleStagedSingleDay () {
  stagedSingleDay.value = !stagedSingleDay.value
  if (!stagedSingleDay.value && normalizeDate(stagedEnd.value)! < normalizeDate(stagedStart.value)!) {
    stagedEnd.value = defaultEndDate(stagedStart.value)
  }
}

// Snap actions and timeline window drags land here as ISO date strings.
function onAnalysisRange (range: { start: string, end: string }) {
  const start = parseDate(range.start)
  const end = parseDate(range.end)
  if (!start || !end) { return }
  stagedStart.value = start
  stagedEnd.value = end
  stagedSingleDay.value = range.start === range.end
}

function onFeedList (ids: string[]) {
  feedOnestopIds.value = ids
}

function onExcludeAll () {
  // Sets up opt-in-by-row by excluding everything currently in view.
  const excluded = new Set(feedOnestopIds.value)
  stagedFvids.value = serializeFvids({ picks: new Map(), excluded })
}

const overrideCount = computed(() => {
  const parsed = parseFvids(stagedFvids.value)
  return parsed.picks.size + parsed.excluded.size
})

function onApply () {
  emit('apply', {
    startDate: stagedStart.value,
    endDate: stagedEndEffective.value,
    fvids: stagedFvids.value,
    singleDay: stagedSingleDay.value,
  })
  emit('update:open', false)
}

function onCancel () {
  emit('update:open', false)
}

// Restages the scenario defaults (next Monday + 6 days, no overrides); the
// user still has to Apply for them to take effect.
function onReset () {
  stagedFvids.value = ''
  stagedStart.value = defaultStartDate()
  stagedEnd.value = defaultEndDate(stagedStart.value)
  stagedSingleDay.value = false
}
</script>

<style scoped>
.cal-fv-modal-dates {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0 24px;
  margin-bottom: 12px;
}
.cal-fv-modal-dates-summary {
  flex: 1 1 280px;
}
.cal-fv-modal-end-date {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cal-fv-modal-count {
  margin-right: auto;
  color: #1d6fb8;
  font-weight: 600;
}
.cal-fv-modal-count.is-empty {
  color: #888;
  font-weight: 400;
}
.cal-fv-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
</style>
