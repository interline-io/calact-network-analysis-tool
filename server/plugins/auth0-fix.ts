// Workaround: @auth0/auth0-nuxt's server plugin is async but Nitro's
// runNitroPlugins() doesn't await async plugins. On Cloudflare Workers,
// the async hook registration never completes before the first request,
// so event.context.auth0ClientOptions is never set. This synchronous
// plugin reads the config per-request (required for CF Workers where
// env vars aren't available at module init time).
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (!event.context.auth0ClientOptions) {
      const config = useRuntimeConfig(event)
      if (config.auth0?.domain) {
        event.context.auth0ClientOptions = config.auth0
        event.context.auth0SessionStore = undefined
      }
    }
  })
})
