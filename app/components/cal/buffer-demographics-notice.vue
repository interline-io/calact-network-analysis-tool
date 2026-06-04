<!-- Shared "stop buffer demographics not loaded" notice + load button (#315
     deferred load). Parents decide visibility; this only renders the prompt. -->
<template>
  <div class="cal-buffer-demographics-notice" :class="{ 'is-compact': compact }">
    <cat-msg variant="info">
      <p>
        Stop buffer demographics aren't loaded for this scenario.
        Loading apportions census data within the statistical radius of each
        stop and can be slow.
      </p>
      <cat-button variant="info" class="mt-2" @click="emit('load')">
        Load stop buffer demographics
      </cat-button>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  // Slim variant for placement above report tables.
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  load: []
}>()
</script>

<style scoped lang="scss">
.cal-buffer-demographics-notice {
  &.is-compact {
    :deep(.message-body) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-top: 8px;
      padding-bottom: 8px;
      p {
        margin: 0;
      }
      .button {
        margin-top: 0 !important;
        flex-shrink: 0;
      }
    }
  }
}
</style>
