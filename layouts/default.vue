<template>
  <div class="outer">
    <div class="sidebar">
      <main-header>
        <template #menu-items>
          <slot name="menu-items" />
        </template>
      </main-header>
    </div>
    <div class="main">
      <slot name="main">
        <div class="container is-fluid">
          <div v-if="!slots.breadcrumbs">
            <tl-breadcrumbs
              :extra-route-names="{
              }"
              :extra-route-tags="{
              }"
            />
          </div>
          <slot />
        </div>
        <div v-if="!slots.footer">
          <slot name="footer">
            <main-footer />
          </slot>
        </div>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSlots } from 'vue'

useHead({
  titleTemplate: (titleChunk) => {
    return titleChunk ? `${titleChunk} • CALACT NAT` : 'CALACT NAT'
  }
})

const slots = useSlots()
</script>

<style scoped lang="scss">
.outer {
  display:flex;
  flex-direction: row;
  min-height: calc(100vh); // minus margins for top and for footer bottom
}

.main {
  flex-grow:1;
  display:flex;
  flex-direction:column;
  margin-left:80px;
  width: calc(100vw - 100px);
}

.container {
  display: flex;
  flex-direction: column;
  flex-grow:1;
  margin-top: 20px;
  margin-right: 20px;
}
.cal-full {
  margin:0px;
}
</style>
