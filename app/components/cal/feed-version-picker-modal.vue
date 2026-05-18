<template>
  <cat-modal
    v-model="modelOpen"
    title="Pick feed versions"
    full-screen
  >
    <div class="cal-fv-modal">
      <cal-feed-version-picker
        v-model="staged"
        v-model:show-all-feeds="showAllFeeds"
        :bbox="bbox"
        :analysis-start="analysisStart"
        :analysis-end="analysisEnd"
        selectable
        @update:feed-onestop-ids="onFeedList"
      />
    </div>

    <template #footer>
      <div class="cal-fv-modal-actions">
        <span class="cal-fv-modal-count" :class="{ 'is-empty': overrideCount === 0 }">
          {{ overrideCount }} override{{ overrideCount === 1 ? '' : 's' }} staged
        </span>
        <cat-tooltip text="By default, feed versions with no scheduled service inside the analysis window are hidden. Turn this on to see every feed version returned by the bbox query, including those that don't overlap.">
          <label class="cal-fv-modal-toggle">
            <input
              type="checkbox"
              :checked="showAllFeeds"
              @change="showAllFeeds = ($event.target as HTMLInputElement).checked"
            >
            <span>Show all</span>
          </label>
        </cat-tooltip>
        <cat-button variant="light" @click="onCancel">
          Cancel
        </cat-button>
        <cat-button variant="light" :disabled="!staged && !modelValue" @click="onReset">
          Reset to defaults
        </cat-button>
        <cat-button variant="light" :disabled="feedOnestopIds.length === 0" @click="onExcludeAll">
          Exclude all
        </cat-button>
        <cat-button variant="primary" @click="onApply">
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
import type { Bbox } from '~~/src/core'

const props = withDefaults(defineProps<{
  open: boolean
  // v-model: committed CSV `fvids` value.
  modelValue?: string
  bbox: Bbox
  analysisStart?: Date | null
  analysisEnd?: Date | null
}>(), {
  modelValue: '',
  analysisStart: null,
  analysisEnd: null,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:modelValue', value: string): void
}>()

const modelOpen = computed<boolean>({
  get: () => props.open,
  set: (v) => { emit('update:open', v) }
})

// Staged copy of the picks. Initialized from props.modelValue every time the
// modal opens so Cancel discards in-modal changes.
const staged = ref<string>(props.modelValue)
const showAllFeeds = ref<boolean>(false)
// Set of feed onestop_ids currently in the picker's bbox query (minus the
// hardcoded denylist). Streamed up from the picker; used to drive bulk
// actions like "Exclude all".
const feedOnestopIds = ref<string[]>([])

function onFeedList (ids: string[]) {
  feedOnestopIds.value = ids
}

function onExcludeAll () {
  // Snapshot the current bbox-feed set into the staged exclude list so the
  // user can then opt feeds back in one by one via their radio buttons.
  const excluded = new Set(feedOnestopIds.value)
  staged.value = serializeFvids({ picks: new Map(), excluded })
}

watch(() => props.open, (open) => {
  if (open) {
    staged.value = props.modelValue
    // Leave showAllFeeds sticky across opens — operator preference, not
    // tied to the committed picks.
  }
})

const overrideCount = computed(() => {
  const parsed = parseFvids(staged.value)
  return parsed.picks.size + parsed.excluded.size
})

function onApply () {
  emit('update:modelValue', staged.value)
  emit('update:open', false)
}

function onCancel () {
  staged.value = props.modelValue
  emit('update:open', false)
}

function onReset () {
  staged.value = ''
}
</script>

<style scoped>
.cal-fv-modal {
  padding: 8px 0;
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
.cal-fv-modal-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #444;
  cursor: pointer;
  user-select: none;
}
</style>
