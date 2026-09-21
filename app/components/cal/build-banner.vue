<template>
  <cat-notification
    v-if="show"
    class="cal-build-banner"
    variant="warning"
    light
    closeable
    v-bind="{ ariaCloseLabel: 'Dismiss build environment notice' }"
    @close="dismiss"
  >
    <cat-icon icon="alert-outline" />
    You are using the <strong>{{ environmentLabel }}</strong> build of the Network Analysis Tool, not production.
    It may include changes that have not been released yet.
    <nuxt-link :to="{ name: 'help' }" target="_blank" rel="noopener noreferrer">About this build</nuxt-link>
  </cat-notification>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'

const { info, isProduction, environmentLabel } = useBuildInfo()

// Dismissal is remembered per build, so the notice comes back after the
// environment is redeployed from a different commit.
const dismissKey = `${info.environment}:${info.sha || info.version}`
const dismissed = useStorage('cal-build-banner-dismissed', '')
const show = computed(() => !isProduction && dismissed.value !== dismissKey)

function dismiss (): void {
  dismissed.value = dismissKey
}
</script>

<style scoped lang="scss">
.cal-build-banner {
  // Flush with the top and right of the content column: this is a banner, not
  // a card sitting inside the page.
  margin: 0;
  border-radius: 0;
  padding: 0.5rem 2.75rem 0.5rem 1rem;
  font-size: 0.85rem;

  // Bulma anchors .delete to the top right corner, which reads as floating on
  // a banner this short. Center it against the right edge instead.
  :deep(.delete) {
    top: 50%;
    right: 0.75rem;
    transform: translateY(-50%);
  }
}
</style>
