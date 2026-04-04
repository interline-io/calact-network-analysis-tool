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
    </div>
    <div v-else>
      You are not logged in. Click <a href="/auth/login">here</a> to login.
    </div>
  </div>
</template>

<script setup lang="ts">
const auth0User = useState('auth0_user')
const roles = useState<string[]>('tlv2_user_roles', () => [])

const user = computed(() => ({
  loggedIn: !!auth0User.value,
  name: (auth0User.value as Record<string, string>)?.name || '',
  email: (auth0User.value as Record<string, string>)?.email || '',
  roles: roles.value,
}))

function logout () {
  useLogout()
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
