<template>
  <div v-if="hasAny || error" class="cal-saved-geography-picker">
    <cat-field label="Saved boundaries">
      <cat-taginput
        :model-value="modelValue"
        :options="options"
        :open-on-focus="true"
        :loading="loading"
        icon="magnify"
        placeholder="Search saved boundaries..."
        empty-text="None chosen: upload a file below"
        fullwidth
        v-bind="{ ariaLabel: 'Saved boundaries' }"
        @update:model-value="emit('update:modelValue', $event.map(String))"
      >
        <template #option="{ option }">
          <div class="is-flex is-align-items-center">
            <span>{{ option.favorite ? '★ ' : '' }}{{ option.label }}</span>
            <span class="tag is-light is-small ml-2">
              {{ option.kind }}
            </span>
          </div>
        </template>
      </cat-taginput>
    </cat-field>
    <p v-if="error" class="help is-danger" role="alert">
      Couldn't load your saved boundaries: {{ error }}
    </p>
    <p v-else-if="chosenKind" class="help">
      Chosen boundaries run as one area. {{ chosenKind === 'upload' ? 'Uploaded boundaries' : 'Census boundary sets' }} can be combined with others of the same kind.
    </p>
    <p v-if="manageUrl" class="help">
      Download or delete saved boundaries on
      <a :href="manageUrl" target="_blank" rel="noopener">your Interline account<span class="is-sr-only"> (opens in a new tab)</span></a>.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { isFavorite, type SavedGeography } from '~~/src/core'
import { useSavedGeographies } from '~/composables/useSavedGeographies'

// Chooses saved boundaries to run as one area; none chosen means uploading a
// file. Self-contained like the census dataset picker: it fetches its own
// options. Hidden until there's something saved.
//
// The server takes one kind of area at a time, so once a boundary is chosen
// only others of its kind (and for Census sets, its dataset) are offered.
const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [ids: string[]]
}>()

const { geographies, loading, error, manageUrl, ensureLoaded } = useSavedGeographies()
onMounted(() => { void ensureLoaded() })

const hasAny = computed(() => (geographies.value?.length ?? 0) > 0)

const chosen = computed(() => (geographies.value || []).filter(g => props.modelValue.includes(g.id)))
const chosenKind = computed(() => chosen.value[0]?.metadata.source)

function combinable (g: SavedGeography): boolean {
  const first = chosen.value[0]
  if (!first || props.modelValue.includes(g.id)) {
    return true
  }
  if (g.metadata.source !== first.metadata.source) {
    return false
  }
  const dataset = first.metadata.dataset
  return !dataset || !g.metadata.dataset || g.metadata.dataset === dataset
}

// Favorites first (the list is kept sorted)
const options = computed(() => (geographies.value || []).filter(combinable).map(g => ({
  value: g.id,
  label: g.name,
  favorite: isFavorite(g),
  kind: g.metadata.source === 'upload' ? 'Uploaded' : 'Census',
})))
</script>
