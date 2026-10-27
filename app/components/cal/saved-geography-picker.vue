<template>
  <div v-if="hasAny || error" class="cal-saved-geography-picker">
    <cat-field>
      <template #label>
        Boundary
      </template>
      <cat-input
        v-if="(geographies?.length ?? 0) > FILTER_MIN"
        v-model="search"
        type="search"
        icon="magnify"
        placeholder="Filter saved boundaries by name..."
        v-bind="{ ariaLabel: 'Filter saved boundaries by name' }"
        class="mb-2"
      />
      <cat-select
        :model-value="modelValue"
        :loading="loading"
        v-bind="{ ariaLabel: 'Boundary' }"
        fullwidth
        @update:model-value="emit('update:modelValue', String($event ?? ''))"
      >
        <option value="">
          Upload a new GeoJSON file
        </option>
        <optgroup label="Saved boundaries">
          <option v-for="g of shown" :key="g.id" :value="g.id">
            {{ isFavorite(g) ? '★ ' : '' }}{{ g.name }}
          </option>
        </optgroup>
      </cat-select>
    </cat-field>
    <p v-if="error" class="help is-danger" role="alert">
      Couldn't load your saved boundaries: {{ error }}
    </p>
    <p v-else-if="search && shown.every(g => g.id === modelValue)" class="help">
      No saved boundaries match "{{ search }}".
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isFavorite } from '~~/src/core'
import { useSavedGeographies } from '~/composables/useSavedGeographies'

// Chooses between uploading a file and one of the user's saved boundaries
// (an empty id means uploading). Self-contained like the census dataset
// picker: it fetches its own options. Hidden until there's something saved.
const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()

// Lists this long or shorter don't need filtering
const FILTER_MIN = 8

const { geographies, loading, error, ensureLoaded } = useSavedGeographies()
onMounted(() => { void ensureLoaded() })

const search = ref('')
const hasAny = computed(() => (geographies.value?.length ?? 0) > 0)

// Favorites first (the list is kept sorted). The chosen boundary stays listed
// while filtering, so the select doesn't lose it.
const shown = computed(() => {
  const term = search.value.trim().toLowerCase()
  return (geographies.value || []).filter(g => g.id === props.modelValue || g.name.toLowerCase().includes(term))
})
</script>
