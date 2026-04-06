<template>
  <div>
    <template v-if="gated && user.loggedIn">
      <slot name="roleText" />
    </template>
    <template v-else-if="gated && !user.loggedIn">
      <slot name="loginText">
        <cat-notification class="mt-4">
          Please log in to access this page.
        </cat-notification>
      </slot>
    </template>
    <client-only v-else>
      <slot />
    </client-only>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  role?: string | null
}>(), {
  role: null,
})

const config = useRuntimeConfig()
const user = useUser()

const gated = computed(() => {
  if (!config.public.tlv2?.loginGate) {
    return false
  }
  if (!user.loggedIn) {
    return true
  }
  if (props.role && !user.hasRole(props.role)) {
    return true
  }
  return false
})
</script>
