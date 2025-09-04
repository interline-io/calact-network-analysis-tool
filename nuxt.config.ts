// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import { stylisticConfig } from 'tlv2-ui/config'

const isDev = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({
  modules: [
    ['tlv2-ui', {
      useProxy: true,
      bulma: '~/assets/main.scss',
    }],
    '@nuxt/devtools',
    '@nuxt/eslint',
  ],
  ssr: false,

  devtools: {
    enabled: isDev
  },

  runtimeConfig: {
    tlv2: {
      graphqlApikey: '',
      proxyBase: '',
    },
    public: {
      test: 'ok',
      tlv2: {
        useProxy: true,
        apiBase: '',
        protomapsApikey: '',
        nearmapsApikey: '',
        auth0Domain: '',
        auth0ClientId: '',
        auth0RedirectUri: '',
        auth0Audience: '',
        auth0Scope: '',
        loginGate: ''
      }
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
    // bug https://github.com/apollographql/apollo-client/issues/9756
    define: {
      __DEV__: isDev.toString()
    },
    server: {
      fs: {
        allow: isDev ? [resolve(__dirname, '../tlv2-ui')] : []
      },
    }
  },
  eslint: {
    config: {
      stylistic: stylisticConfig,
    },
  },
})
