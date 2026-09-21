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
    <a :href="githubUrl" target="_blank" rel="noopener noreferrer">{{ summary }}</a>
  </cat-notification>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'

const { info, isProduction, environmentLabel, summary, githubUrl } = useBuildInfo()

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
  margin: 0.75rem 1.25rem 0 0;
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  font-size: 0.85rem;
}
</style>
