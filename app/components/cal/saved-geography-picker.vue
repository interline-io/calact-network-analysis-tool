<template>
  <div class="cal-saved-geography-picker">
    <cat-field>
      <template #label>
        Saved geographies
      </template>
      <cat-input
        v-if="(geographies?.length ?? 0) > FILTER_MIN"
        v-model="search"
        type="search"
        icon="magnify"
        placeholder="Filter by name..."
        v-bind="{ ariaLabel: 'Filter saved geographies by name' }"
        class="mb-2"
      />
      <cat-select
        :model-value="modelValue"
        :disabled="!hasAny"
        :loading="loading"
        v-bind="{ ariaLabel: 'Saved geography' }"
        fullwidth
        @update:model-value="emit('update:modelValue', String($event ?? ''))"
      >
        <option value="" disabled>
          {{ placeholder }}
        </option>
        <option v-for="g of shown" :key="g.id" :value="g.id">
          {{ isFavorite(g) ? '★ ' : '' }}{{ g.name }}
        </option>
      </cat-select>
    </cat-field>
    <p v-if="error" class="help is-danger" role="alert">
      Couldn't load your saved geographies: {{ error }}
    </p>
    <p v-else-if="geographies && !hasAny" class="help">
      You haven't saved any geographies yet. Upload a GeoJSON file or select administrative boundaries, then save them.
    </p>
    <p v-else-if="search && shown.length === (modelValue && !matchesSearch(selected) ? 1 : 0)" class="help">
      No saved geographies match "{{ search }}".
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isFavorite, type SavedGeography } from '~~/src/core'
import { useSavedGeographies } from '~/composables/useSavedGeographies'

// Self-contained like the census dataset picker: it fetches its own options
// (the user's saved geographies) and reports the chosen id.
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
const selected = computed(() => geographies.value?.find(g => g.id === props.modelValue))

function matchesSearch (g?: SavedGeography): boolean {
  return !!g && g.name.toLowerCase().includes(search.value.trim().toLowerCase())
}

// Favorites first (the list is kept sorted). The chosen geography stays listed
// while filtering, so the select doesn't lose it.
const shown = computed(() => (geographies.value || []).filter(g => g.id === props.modelValue || matchesSearch(g)))

const placeholder = computed(() => {
  if (loading.value && !geographies.value) {
    return 'Loading...'
  }
  if (!hasAny.value) {
    return 'No saved geographies'
  }
  return 'Choose a saved geography'
})
</script>
