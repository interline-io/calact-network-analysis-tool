<template>
  <section class="cal-build-info content">
    <h2 class="title is-5">
      About this build
    </h2>
    <table class="table is-narrow">
      <tbody>
        <tr>
          <th>Environment</th>
          <td>{{ environmentLabel }}</td>
        </tr>
        <tr v-if="info.version">
          <th>Version</th>
          <td>
            <a :href="githubUrl" target="_blank" rel="noopener noreferrer">{{ info.version }}</a>
          </td>
        </tr>
        <tr v-if="info.sha">
          <th>Commit</th>
          <td>
            <a :href="commitUrl" target="_blank" rel="noopener noreferrer"><code>{{ shortSha }}</code></a>
            <span v-if="info.branch"> on {{ info.branch }}</span>
          </td>
        </tr>
        <tr v-if="builtAtLabel">
          <th>Built</th>
          <td>{{ builtAtLabel }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
const { info, environmentLabel, shortSha, builtAtLabel, githubUrl, commitUrl } = useBuildInfo()
</script>

<style scoped lang="scss">
.cal-build-info {
  th {
    width: 10rem;
    white-space: nowrap;
  }
}
</style>
