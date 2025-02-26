<template>
  <div class="cal-sidebar sidebar is-active">
    <div class="sidebar-content is-left is-fullheight is-mini">
      <nuxt-link :to="{name:'index'}" class="ca-main-item" title="Home" role="button">
        <o-icon icon="home" size="large" class="is-fullwidth" />
      </nuxt-link>
      <aside class="menu">
        <slot name="menu-items" />
        <div class="bottom-group">
          <ul class="menu-list">
            <li>
              <a role="button" @click="toggleDarkMode()" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
                <o-icon
                  class="icon-group"
                  size="large"
                  :icon="isDark ? 'weather-night' : 'weather-sunny'"
                />
              </a>
            </li>
            <li>
              <nuxt-link
                :to="{ name: 'help' }"
                :class="itemHelper('/help')"
                title="Help"
                role="button"
              >
                <o-icon icon="help" size="large" class="is-fullwidth" />
              </nuxt-link>
            </li>

            <li>
              <nuxt-link
                :to="{ name: 'admin-profile' }"
                :class="itemHelper('/admin/profile')"
                title="My user profile"
                role="button"
              >
                <o-icon icon="account" size="large" class="is-fullwidth" />
              </nuxt-link>
            </li>
          </ul>
        </div>
      </aside>
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

const loggedIn = useUser()?.loggedIn

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
      a:hover:not(.is-active) {
        background:#ccc;
      }

  .ca-main-item {
    border-bottom:solid 1px #eee;
    padding-top:10px;
    padding-bottom:10px;
  }

  .is-active {
    background:var(--bulma-primary);
    color:var(--bulma-white);
  }

  .icon {
    font-size: 1.75em;
    color: var(--bulma-white);
    &.is-fullwidth {
      width: 100%;
    }
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

  a {
    background: none;
    color: var(--bulma-text-on-theme);
    &:hover {
      background:var(--bulma-primary);
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
