<template>
  <div class="cal-sidebar sidebar is-active">
    <div class="sidebar-content is-left is-fullheight is-mini">
      <nuxt-link :to="{ name: 'index' }" class="ca-main-item" title="Home" aria-label="Home">
        <cat-icon icon="home" size="large" class="is-fullwidth" variant="white" />
      </nuxt-link>
      <nav class="menu" aria-label="Main">
        <slot name="menu-items" />
        <div class="bottom-group">
          <ul class="menu-list">
            <li>
              <button
                type="button"
                class="cal-icon-button"
                :title="debugMenu ? 'Turn off debug' : 'Turn on debug'"
                :aria-label="debugMenu ? 'Turn off debug' : 'Turn on debug'"
                :aria-pressed="debugMenu"
                @click="debugMenuToggle()"
              >
                <cat-icon
                  size="large"
                  icon="application-cog"
                  :variant="debugMenu ? 'warning' : 'white'"
                />
              </button>
            </li>

            <li>
              <button
                type="button"
                class="cal-icon-button"
                :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
                :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
                :aria-pressed="isDark"
                @click="toggleDarkMode()"
              >
                <cat-icon
                  class="icon-group"
                  size="large"
                  :icon="isDark ? 'weather-night' : 'weather-sunny'"
                  variant="white"
                />
              </button>
            </li>
            <li>
              <nuxt-link
                :to="{ name: 'help' }"
                :class="itemHelper('/help')"
                title="Help"
                aria-label="Help"
                target="_blank"
              >
                <cat-icon icon="help" size="large" class="is-fullwidth" variant="white" />
              </nuxt-link>
            </li>

            <li>
              <nuxt-link
                :to="{ name: 'admin-profile' }"
                :class="itemHelper('/admin/profile')"
                title="My user profile"
                aria-label="My user profile"
              >
                <cat-icon icon="account" size="large" class="is-fullwidth" variant="white" />
              </nuxt-link>
            </li>
          </ul>
        </div>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDark, useToggle } from '@vueuse/core'

const isDark = useDark({
  selector: 'html',
  attribute: 'data-theme',
  valueDark: 'dark',
  valueLight: 'light',
})

const route = useRoute()

const toggleDarkMode = useToggle(isDark)

const debugMenu = useDebugMenu()
const debugMenuToggle = useToggle(debugMenu)

function itemHelper (p: string): string {
  if (route.path.startsWith(p)) {
    return 'is-active'
  }
  return 'is-secondary'
}
</script>

<style lang="scss">
/* Has to be global style for <template> to work */
  .cal-sidebar {

.sidebar-content {
  height: 100%;
  width: 80px !important;
  background: #000 !important;
  display: flex;
  flex-grow: 1;
  flex-direction: column;

  --bulma-duration: 1ms;
      a:hover:not(.is-active),
      .cal-icon-button:hover:not(.is-active) {
        background:#ccc;
      }

  .ca-main-item {
    border-bottom:solid 1px #eee;
    padding-top:10px;
    padding-bottom:10px;
    display: flex;
    justify-content: center;
  }

  .bottom-group {
    margin-top: auto;
  }

  img.icon {
    height: 1em;
    width: 1em;
  }

  .icon-group {
    width: 100%;
    text-align: center;
  }

  a,
  .cal-icon-button {
    background: none;
    color: var(--bulma-text-on-theme);
    display: flex;
    justify-content: center;
    &.is-active {
      background: var(--bulma-primary);
    }
    &:hover {
      background:var(--bulma-primary);
    }
  }

  .cal-icon-button {
    width: 100%;
    border: none;
    padding: 0.5em 0.25em;
    cursor: pointer;
    font: inherit;

    &:focus-visible {
      outline: 2px solid var(--bulma-primary);
      outline-offset: -2px;
    }
  }

  .menu {
    display: flex;
    flex-grow: 1;
    flex-direction: column;

    p.menu-label {
      display: flex;
    }

    ul.menu-list {
      display: flex;
      flex-direction: column;

      li {
        display: flex;
        flex-wrap: wrap;
        flex-direction: column;
        a {
          padding: 0.5em 0.25em;
        }
      }
    }
  }
}
}
</style>
