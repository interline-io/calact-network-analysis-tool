<template>
  <cat-field>
    <template #label>
      <slot name="label">
        End date
      </slot>
    </template>
    <cat-datepicker
      v-if="!singleDay"
      ref="endPickerRef"
      v-model="endModel"
      :min-date="minDate"
      :max-date="maxDate"
      :years-range="yearsRange"
      :variant="invalid ? 'danger' : undefined"
    >
      <!-- The remove button joins the picker's addon group (catenary 0.6.0)
           instead of floating beside it. camelCase keys in the v-bind object:
           matches the ariaLabel/title props and avoids vue/attribute-hyphenation
           rewriting a camelCase attribute back to kebab (which vue-tsc won't
           map to the prop). -->
      <template #addon>
        <cat-button
          icon="close"
          v-bind="{ ariaLabel: 'Remove end date', title: singleDayTitle }"
          @click="emit('update:singleDay', true)"
        />
      </template>
    </cat-datepicker>
    <cat-button v-else ref="setEndButtonRef" @click="emit('update:singleDay', false)">
      Set an end date
    </cat-button>
    <p v-if="beforeStart" class="help is-danger">
      End date must be on or after the start date.
    </p>
  </cat-field>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'

// Shared end-date control: a date picker plus a single-day toggle, used by both
// the Query panel and the Feed Archive modal so the toggle markup, the
// catenary aria/title workaround, the "on or after" validity help, and the
// keyboard-focus handling (#361) live in one place. The owner keeps the
// single-day data invariant (e.g. end === start, or bumping to a default end);
// this component only emits the intent.
const props = withDefaults(defineProps<{
  end: Date
  singleDay: boolean
  minDate: Date
  maxDate: Date
  // Relative year offsets [before, after] from the current year, for the
  // picker's year dropdown.
  yearsRange: [number, number]
  // Renders the end picker in a danger variant (e.g. out of range / before start).
  invalid?: boolean
  // Shows the "End date must be on or after the start date" help.
  beforeStart?: boolean
  // Title/tooltip on the "remove end date" button.
  singleDayTitle?: string
}>(), {
  invalid: false,
  beforeStart: false,
  singleDayTitle: 'Remove end date (analyze a single day)',
})

const emit = defineEmits<{
  (e: 'update:end', value: Date): void
  (e: 'update:singleDay', value: boolean): void
}>()

const endModel = computed<Date>({
  get: () => props.end,
  set: (v) => { emit('update:end', v) },
})

const endPickerRef = ref<{ focus: () => void } | null>(null)
const setEndButtonRef = ref<ComponentPublicInstance | null>(null)

// #361 — keep keyboard focus sensible across the toggle: move into the end
// picker when it appears, onto the "Set an end date" button when it replaces it.
watch(() => props.singleDay, async (single) => {
  await nextTick()
  if (single) {
    const el = setEndButtonRef.value?.$el as HTMLElement | undefined
    el?.focus?.()
  } else {
    endPickerRef.value?.focus()
  }
})
</script>
