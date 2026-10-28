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
        {{ request?.summary }}
      </p>
      <p v-if="tooLarge" class="help is-danger" role="alert">
        This geography is {{ sizeMb }} MB, more than the {{ maxMb }} MB that can be saved. Turn on rounding and simplifying under Simplification options, or choose fewer features.
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
import { jsonByteLength, SAVED_GEOGRAPHY_MAX_BYTES, type SavedGeography, type SaveGeographyRequest } from '~~/src/core'
import { iwaErrorMessage, useSavedGeographies } from '~/composables/useSavedGeographies'

// Saves a geography to the user's Interline account: the caller builds what's
// saved, and the user names it.
const props = defineProps<{
  open: boolean
  // What to save, but its name; null while closed
  request: SaveGeographyRequest | null
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
    name.value = props.request?.defaultName ?? ''
    error.value = ''
  }
})

const size = computed(() => props.request ? jsonByteLength(props.request.geography.content) : 0)
const tooLarge = computed(() => size.value > SAVED_GEOGRAPHY_MAX_BYTES)
const sizeMb = computed(() => (size.value / 1024 / 1024).toFixed(1))
const maxMb = (SAVED_GEOGRAPHY_MAX_BYTES / 1024 / 1024).toFixed(1)

async function save () {
  if (!props.request || !name.value.trim() || tooLarge.value || saving.value) {
    return
  }
  saving.value = true
  error.value = ''
  try {
    const saved = await create({ ...props.request.geography, name: name.value.trim() })
    emit('saved', saved)
    emit('update:open', false)
  } catch (e) {
    error.value = `Couldn't save: ${iwaErrorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>
