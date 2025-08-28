// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { stylisticConfig } from './node_modules/tlv2-ui/dist/runtime/config/eslint.js'

const isDev = process.env.NODE_ENV === 'development'

function getTlv2UiModule (): [string, { bulma: string, useProxy: boolean, safelinkUtmSource: string }] {
  const config = {
    bulma: '~/assets/main.scss',
    useProxy: true,
    safelinkUtmSource: 'transitland'
  }

  if (process.env.TLV2_LINK === 'true') {
    // Use local tlv2-ui development version
    return ['../tlv2-ui/src/module.ts', config]
  } else {
    // Use package.json version from github.com
    return ['tlv2-ui', config]
  }
}

export default defineNuxtConfig({

  modules: [
    getTlv2UiModule(),
    '@nuxt/devtools',
    '@nuxt/eslint',
  ],
  ssr: false,

  devtools: {
    enabled: isDev
  },

  runtimeConfig: {
    proxyBase: '',
    allowedReferer: '',
    graphqlApikey: '',
    public: {
      apiBase: '',
      protomapsApikey: '',
      nearmapsApikey: '',
      auth0Domain: '',
      auth0ClientId: '',
      auth0RedirectUri: '',
      auth0Audience: '',
      auth0Scope: '',
      loginGate: '',
      requireLogin: '',
    }
  },

  // Disable CSRF
  routeRules: {
    '/api/**': {
      csurf: false,
    },
  },

  compatibilityDate: '2025-02-18',

  vite: {
    // https://github.com/nuxt/nuxt/issues/20001
    resolve: {
      preserveSymlinks: true
    },
    server: {
      fs: {
        allow: ['/Users/irees/src/interline-io', '/Users/drew/code/interline-io']
      }
    }
  },
  eslint: {
    config: {
      stylistic: stylisticConfig,
    },
  }
})
