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
          <tl-login-gate role="tl_calact_nat">
            <template #roleText>
              <t-notification class="mt-4">
                <t-icon icon="lock" /> Your account does not have permission to access this page. To gain access, contact the project managers.
              </t-notification>
            </template>
            <slot />
          </tl-login-gate>
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
