<template>
  <div>
    <cal-title title="Your account" />

    <div v-if="user.loggedIn" class="mb-4">
      <cat-card class="mb-5">
        <div class="level">
          <div class="level-left">
            <div>
              <p class="title is-5">
                {{ user.name }}
              </p>
              <p class="subtitle is-6">
                {{ user.email }}
              </p>
            </div>
          </div>
          <div class="level-right">
            <cat-button icon-left="logout" @click="logout">
              Sign out
            </cat-button>
          </div>
        </div>
      </cat-card>

      <section class="mb-5">
        <h2 class="title is-4">
          Your access
        </h2>
        <ul class="mb-3">
          <li class="is-flex mb-3">
            <cat-icon icon="check-circle" variant="success" class="mr-2" />
            <div>
              <strong>Network Analysis Tool</strong>
              <p class="help">
                Explore and analyze transit service across California, Oregon and Washington.
              </p>
            </div>
          </li>
          <li class="is-flex mb-3">
            <cat-icon :icon="savedBoundaryStatus.icon" :variant="savedBoundaryStatus.variant" class="mr-2" />
            <div>
              <strong>Saved boundaries</strong>
              <p class="help">
                {{ savedBoundaryStatus.text }}
              </p>
            </div>
          </li>
        </ul>
        <p>
          Your Interline account shows your plan and any other Interline products you can use:
          <a :href="accountUrl" target="_blank" rel="noopener">view your Interline account<cat-icon icon="open-in-new" size="small" /><span class="is-sr-only"> (opens in a new tab)</span></a>
        </p>
      </section>

      <!-- The anchor renders right away, so a link here can scroll to it
           before the access check decides whether the section shows -->
      <div id="saved-boundaries">
        <section v-if="savedGeographyAccess?.list" class="mb-5">
          <h2 class="title is-4">
            Saved boundaries
          </h2>
          <p class="mb-2">
            Boundaries you've saved from the Query tab. Starred ones are listed first when you choose a saved boundary.
          </p>
          <cal-saved-geography-manager />
        </section>
      </div>

      <!-- For troubleshooting: what the sign-in carries, and whether Interline
           accepts it. Shown only with the sidebar's debug toggle on. -->
      <cat-card v-if="debugMenu" label="Advanced" expandable class="mb-5">
        <h3 class="title is-6">
          Sign-in roles
        </h3>
        <div v-if="user.roles.length > 0" class="tags">
          <cat-tag v-for="role in user.roles" :key="role" class="is-family-monospace">
            {{ role }}
          </cat-tag>
        </div>
        <p v-else class="mb-4">
          No roles assigned to your account.
        </p>

        <h3 class="title is-6">
          Interline account
        </h3>
        <p class="mb-2">
          Checks that Interline accepts this app's sign-in, which saved boundaries rely on.
        </p>
        <cat-button :loading="iwaLoading" class="mb-3" @click="checkIwa">
          Check Interline account
        </cat-button>
        <div v-if="iwaAccount" class="notification is-success is-light">
          Interline account <strong>{{ iwaAccount.id }}</strong> ({{ iwaAccount.email }})
          <div v-for="(roles, product) in iwaAccount.roles" :key="product" class="mt-2">
            <span class="has-text-weight-semibold">{{ product }}:</span>
            <span v-for="role in roles" :key="role" class="tag ml-1">{{ role }}</span>
          </div>
        </div>
        <div v-else-if="iwaError" class="notification is-danger is-light">
          {{ iwaError }}
        </div>
      </cat-card>
    </div>
    <div v-else>
      You are not logged in. Click <a href="/auth/login">here</a> to login.
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IwaMe } from '~~/server/api/iwa/me.get'
import { capitalize, SAVED_GEOGRAPHY_ACTIONS, type SavedGeographyPermission } from '~~/src/core'
import CalSavedGeographyManager from '~/components/cal/saved-geography-manager.vue'
import { useInterlineAccountUrl } from '~/composables/useInterlineAccount'
import { iwaErrorMessage, useSavedGeographies } from '~/composables/useSavedGeographies'

const user = useUser()
const debugMenu = useDebugMenu()
const accountUrl = useInterlineAccountUrl()

const { access: savedGeographyAccess, accessError: savedGeographyAccessError, loadAccess } = useSavedGeographies()
onMounted(() => { void loadAccess() })

// What the user's plan lets them do with saved boundaries ("View, save and
// rename boundaries..."), or why it isn't known
const savedBoundaryStatus = computed((): { icon: string, variant?: 'success', text: string } => {
  const a = savedGeographyAccess.value
  if (!a) {
    return { icon: 'loading', text: 'Checking your Interline account...' }
  }
  if (savedGeographyAccessError.value) {
    return { icon: 'alert-circle-outline', text: `Couldn't check your Interline account: ${savedGeographyAccessError.value}` }
  }
  if (!a.list) {
    return { icon: 'minus-circle-outline', text: 'Not included with your account. To add it, contact the project managers.' }
  }
  const verbs = (Object.keys(SAVED_GEOGRAPHY_ACTIONS) as SavedGeographyPermission[])
    .filter(p => a[p])
    .map(p => SAVED_GEOGRAPHY_ACTIONS[p])
  const phrase = new Intl.ListFormat('en', { type: 'conjunction' }).format(verbs)
  return { icon: 'check-circle', variant: 'success', text: `${capitalize(phrase)} boundaries in your Interline account.` }
})

function logout () {
  useLogout()
}

const iwaAccount = ref<IwaMe | null>(null)
const iwaError = ref('')
const iwaLoading = ref(false)

async function checkIwa () {
  iwaLoading.value = true
  iwaAccount.value = null
  iwaError.value = ''
  try {
    iwaAccount.value = await $fetch<IwaMe>('/api/iwa/me')
    // Clears an earlier failed check from Your access
    void loadAccess()
  } catch (e) {
    const err = e as { statusCode?: number, data?: { data?: { error?: string } } }
    iwaError.value = [err.statusCode, err.data?.data?.error, iwaErrorMessage(e)].filter(Boolean).join(' · ')
  } finally {
    iwaLoading.value = false
  }
}
</script>
