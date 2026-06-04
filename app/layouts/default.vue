<template>
  <div class="outer">
    <a href="#main" class="cal-skip-link">Skip to main content</a>
    <div class="sidebar">
      <main-header>
        <template #menu-items>
          <slot name="menu-items" />
        </template>
      </main-header>
    </div>
    <main id="main" class="main" tabindex="-1">
      <slot name="main">
        <div class="container is-fluid">
          <cal-login-gate role="tl_calact_nat">
            <template #roleText>
              <cat-notification class="mt-4">
                <cat-icon icon="lock" /> Your account does not have permission to access this page. To gain access, contact the project managers.
              </cat-notification>
            </template>
            <slot />
          </cal-login-gate>
        </div>
        <div v-if="!slots.footer">
          <slot name="footer">
            <main-footer />
          </slot>
        </div>
      </slot>
    </main>
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

.cal-skip-link {
  position: absolute;
  top: -100px;
  left: 0;
  z-index: 100000;
  padding: 0.75rem 1rem;
  background: var(--bulma-primary);
  color: var(--bulma-primary-invert);
  font-weight: bold;
  text-decoration: none;

  &:focus {
    top: 0;
    outline: 2px solid var(--bulma-link-focus-border);
    outline-offset: 2px;
  }
}

// Only suppress the focus ring for programmatic focus (e.g. after the
// skip-link jump). Keyboard users still see a visible indicator.
.main:focus:not(:focus-visible) {
  outline: none;
}
</style>
