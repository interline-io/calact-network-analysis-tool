<template>
  <div>
    <tl-title title="Welcome to the Network Analysis Tool" />

    <div class="columns">
      <div class="column"><p class="content">The Network Analysis Tool (or NAT) is being developed for the California Association for Coordinated Transportation (CALACT) and partner organizations to browse transit networks throughout California, Oregon, and Washington states.</p></div>
      <div class="column has-text-right"><img src="~assets/calact-logo.jpg" alt="CALACT"></div>
    </div>
    
    <tl-msg-info>This tool is currently under active development. To gain access, contact the project managers.</tl-msg-info>
    <nuxt-link class="button is-primary is-large is-fullwidth" :to="{name: 'tne'}">
      Start Building a Query
    </nuxt-link>
  </div>
</template>

<script setup lang="ts">
const loading = true
</script>
