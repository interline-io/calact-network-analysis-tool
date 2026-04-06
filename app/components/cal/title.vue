<template>
  <div>
    <h1 class="title is-1">
      <slot>{{ title }}</slot>
    </h1>
    <Head>
      <Title>{{ title }}</Title>
      <Meta name="description" :content="description || title" />
    </Head>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
}>(), {
  title: '',
  description: '',
})
</script>

<style scoped>
h1 {
  margin-bottom: 0.5em;
  margin-top: 0.5em;
}
</style>
