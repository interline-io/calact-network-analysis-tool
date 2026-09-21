<template>
  <a
    class="cal-build-chip"
    :class="{ 'cal-build-chip-nonprod': !isProduction }"
    :href="githubUrl"
    target="_blank"
    rel="noopener noreferrer"
    :title="summary"
    :aria-label="`${summary}. Opens this build on GitHub.`"
  >
    <span class="cal-build-chip-env">{{ environmentShortLabel }}</span>
    <span v-if="versionLabel" class="cal-build-chip-version">{{ versionLabel }}</span>
  </a>
</template>

<script setup lang="ts">
const { isProduction, environmentShortLabel, versionLabel, summary, githubUrl } = useBuildInfo()
</script>
