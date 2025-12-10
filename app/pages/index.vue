<template>
  <div>
    <tl-title title="Welcome to the Network Analysis Tool" />

    <div class="columns">
      <div class="column">
        <p class="content">
          The Network Analysis Tool (or NAT) is being developed for the California Association for Coordinated Transportation (CALACT) and partner organizations to browse transit networks throughout California, Oregon, and Washington states.
        </p>
      </div>
      <div class="column has-text-right mr-6">
        <img style="max-width: 350px;" src="~assets/odot-logo.svg" alt="Oregon Dept of Transportation">
      </div>
    </div>

    <t-msg variant="info">
      This tool is currently under active development. To gain access, contact the project managers.
    </t-msg>
    <nuxt-link class="button is-primary is-large is-fullwidth" :to="{ name: 'tne' }">
      Start Building a Query
    </nuxt-link>
  </div>
</template>

<script setup lang="ts">
</script>
