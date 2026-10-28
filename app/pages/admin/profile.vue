<template>
  <div>
    <cal-title title="My User Profile" />

    <div v-if="user.loggedIn" class="mb-4">
      <div class="columns">
        <div class="column is-9">
          <div class="notification">
            You are currently logged in as <strong>{{ user.name }} ({{ user.email }})</strong>
          </div>
        </div>
        <div class="column is-3">
          <cat-button variant="primary" size="large" class="is-pulled-right" @click="logout">
            Sign out
          </cat-button>
        </div>
      </div>

      <div class="mb-4">
        <h3 class="title is-3">
          Roles
        </h3>
        <p class="mb-2">
          Your account has been assigned the following roles:
        </p>
        <div v-if="user.roles.length > 0" class="roles-list">
          <div v-for="role in user.roles" :key="role" class="notification">
            <span class="tag is-medium">{{ role }}</span>
          </div>
        </div>
        <div v-else class="notification">
          No roles assigned to your account.
        </div>
      </div>

      <div v-if="savedGeographyAccess?.list" class="mb-4">
        <h3 class="title is-3">
          Saved geographies
        </h3>
        <p class="mb-2">
          Areas you've saved from the Query tab. Starred ones are listed first when you load a saved boundary.
        </p>
        <cal-saved-geography-manager />
      </div>

      <div class="mb-4">
        <h3 class="title is-3">
          Interline account
        </h3>
        <p class="mb-2">
          Checks that Interline accepts this app's sign-in, which saving to your profile will rely on.
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
      </div>
    </div>
    <div v-else>
      You are not logged in. Click <a href="/auth/login">here</a> to login.
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IwaMe } from '~~/server/api/iwa/me.get'
import CalSavedGeographyManager from '~/components/cal/saved-geography-manager.vue'
import { iwaErrorMessage, useSavedGeographies } from '~/composables/useSavedGeographies'

const user = useUser()

const { access: savedGeographyAccess, loadAccess } = useSavedGeographies()
onMounted(() => { void loadAccess() })

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
  } catch (e) {
    const err = e as { statusCode?: number, data?: { data?: { error?: string } } }
    iwaError.value = [err.statusCode, err.data?.data?.error, iwaErrorMessage(e)].filter(Boolean).join(' · ')
  } finally {
    iwaLoading.value = false
  }
}
</script>

<style scoped>
.roles-list .notification {
  border-left: 4px solid #3273dc;
}

.roles-list .tag {
  font-family: monospace;
}
</style>
