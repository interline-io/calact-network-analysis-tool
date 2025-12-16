<template>
  <div class="control cal-timepicker" :class="controlClasses">
    <input
      ref="inputRef"
      type="time"
      class="input"
      :class="inputClasses"
      :value="timeString"
      :disabled="disabled"
      @input="handleInput"
    >
    <span v-if="icon" class="icon is-left">
      <i :class="`mdi mdi-${icon}`" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  /**
   * The v-model value as a Date object.
   */
  modelValue?: Date

  /**
   * MDI icon name for left icon (without mdi- prefix).
   */
  icon?: string

  /**
   * The size of the input.
   * @values small, normal, medium, large
   */
  size?: 'small' | 'normal' | 'medium' | 'large'

  /**
   * Whether the input is disabled.
   */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'normal',
  disabled: false
})

const emit = defineEmits<{
  'update:modelValue': [value: Date | undefined]
}>()

const inputRef = ref<HTMLInputElement>()

// Convert Date to HH:mm string for the input
const timeString = computed(() => {
  if (!props.modelValue) {
    return ''
  }
  const hours = props.modelValue.getHours().toString().padStart(2, '0')
  const minutes = props.modelValue.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
})

// Handle input changes and emit Date object
function handleInput (event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value

  if (!value) {
    emit('update:modelValue', undefined)
    return
  }

  const parts = value.split(':').map(Number)
  const hours = parts[0] ?? 0
  const minutes = parts[1] ?? 0
  const date = props.modelValue ? new Date(props.modelValue) : new Date()
  date.setHours(hours, minutes, 0, 0)
  emit('update:modelValue', date)
}

const controlClasses = computed(() => {
  const classes: string[] = []
  if (props.icon) {
    classes.push('has-icons-left')
  }
  return classes
})

const inputClasses = computed(() => {
  const classes: string[] = []
  if (props.size && props.size !== 'normal') {
    classes.push(`is-${props.size}`)
  }
  return classes
})
</script>

<style scoped lang="scss">
.cal-timepicker {
  input[type="time"] {
    // Ensure consistent width for time inputs
    min-width: 120px;
  }
}
</style>
