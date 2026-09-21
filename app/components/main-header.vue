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
                rel="noopener noreferrer"
              >
                <cat-icon icon="help" size="large" class="is-fullwidth" variant="white" />
              </nuxt-link>
            </li>

            <li>
              <nuxt-link
                to="/job-status"
                :class="itemHelper('/job-status')"
                class="cal-jobs-link"
                title="Jobs"
                aria-label="Jobs"
              >
                <cat-icon icon="clipboard-text-clock" size="large" class="is-fullwidth" variant="white" />
                <span v-if="activeJobCount > 0" class="cal-jobs-badge" aria-hidden="true">{{ activeJobCount > 9 ? '9+' : activeJobCount }}</span>
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

const { activeCount: activeJobCount, ensureWatching } = useJobTracker()
// Resume watching non-terminal session-started jobs in this tab — covers the
// new-tab handoff from the Feed Archive modal's job links.
onMounted(() => { ensureWatching() })

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

  .cal-jobs-link {
    position: relative;
  }

  .cal-jobs-badge {
    position: absolute;
    top: 4px;
    right: 16px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bulma-danger);
    color: #fff;
    font-size: 0.65rem;
    line-height: 16px;
    text-align: center;
    pointer-events: none;
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

    // aria-disabled keeps the button in the tab order so screen readers can
    // discover its disabled state, but it shouldn't show hover/click affordances.
    &[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.5;
      &:hover {
        background: none;
      }
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
