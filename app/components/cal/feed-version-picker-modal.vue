<template>
  <cat-modal
    v-model="modelOpen"
    title="Pick feed versions"
    full-screen
  >
    <cal-feed-version-picker
      v-model="staged"
      :bbox="bbox"
      :analysis-start="analysisStart"
      :analysis-end="analysisEnd"
      selectable
      @update:feed-onestop-ids="onFeedList"
    />

    <template #footer>
      <div class="cal-fv-modal-actions">
        <span class="cal-fv-modal-count" :class="{ 'is-empty': overrideCount === 0 }">
          {{ overrideCount }} override{{ overrideCount === 1 ? '' : 's' }} staged
        </span>
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
  // v-model: committed fvids CSV.
  modelValue?: string
  bbox: Bbox
  analysisStart: Date
  analysisEnd: Date
}>(), {
  modelValue: '',
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:modelValue', value: string): void
}>()

const modelOpen = computed<boolean>({
  get: () => props.open,
  set: (v) => { emit('update:open', v) }
})

// Staged so Cancel discards in-modal edits. Reset on each open below.
const staged = ref<string>(props.modelValue)
const feedOnestopIds = ref<string[]>([])

function onFeedList (ids: string[]) {
  feedOnestopIds.value = ids
}

function onExcludeAll () {
  // Sets up opt-in-by-row by excluding everything currently in view.
  const excluded = new Set(feedOnestopIds.value)
  staged.value = serializeFvids({ picks: new Map(), excluded })
}

watch(() => props.open, (open) => {
  if (open) {
    staged.value = props.modelValue
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
