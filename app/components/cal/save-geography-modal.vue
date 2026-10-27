<template>
  <cat-modal
    :model-value="open"
    title="Save geography to your profile"
    size="small"
    @update:model-value="emit('update:open', $event)"
  >
    <form @submit.prevent="save">
      <cat-field label="Name">
        <cat-input
          v-model="name"
          :maxlength="200"
          v-bind="{ ariaLabel: 'Name for the saved geography' }"
          expanded
        />
      </cat-field>
      <p class="help">
        {{ summary }}
      </p>
      <p v-if="tooLarge" class="help is-danger" role="alert">
        This geography is {{ sizeMb }} MB, more than the {{ maxMb }} MB that can be saved. Turn on rounding and simplifying under Upload options, or choose fewer features.
      </p>
      <p v-if="error" class="help is-danger" role="alert">
        {{ error }}
      </p>
    </form>
    <template #footer>
      <div class="buttons">
        <cat-button variant="primary" :loading="saving" :disabled="!name.trim() || tooLarge" @click="save">
          Save
        </cat-button>
        <cat-button @click="emit('update:open', false)">
          Cancel
        </cat-button>
      </div>
    </template>
  </cat-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SAVED_GEOGRAPHY_MAX_BYTES, type SavedGeography, type SavedGeographyCreate } from '~~/src/core'
import { savedGeographyErrorMessage, useSavedGeographies } from '~/composables/useSavedGeographies'

// Saves a geography to the user's Interline account: the caller builds what's
// saved, and the user names it.
const props = defineProps<{
  open: boolean
  defaultName: string
  // What to save, but its name
  geography: Omit<SavedGeographyCreate, 'name'> | null
  // Describes what's being saved, e.g. "3 county boundaries"
  summary: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': [geography: SavedGeography]
}>()

const { create } = useSavedGeographies()

const name = ref('')
const saving = ref(false)
const error = ref('')

watch(() => props.open, (open) => {
  if (open) {
    name.value = props.defaultName
    error.value = ''
  }
})

const size = computed(() => props.geography ? JSON.stringify(props.geography.content).length : 0)
const tooLarge = computed(() => size.value > SAVED_GEOGRAPHY_MAX_BYTES)
const sizeMb = computed(() => (size.value / 1024 / 1024).toFixed(1))
const maxMb = (SAVED_GEOGRAPHY_MAX_BYTES / 1024 / 1024).toFixed(1)

async function save () {
  if (!props.geography || !name.value.trim() || tooLarge.value || saving.value) {
    return
  }
  saving.value = true
  error.value = ''
  try {
    const saved = await create({ ...props.geography, name: name.value.trim() })
    emit('saved', saved)
    emit('update:open', false)
  } catch (e) {
    error.value = `Couldn't save: ${savedGeographyErrorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>
