// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { stylisticConfig } from './node_modules/tlv2-ui/dist/runtime/config/eslint.js'

const isDev = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({

  modules: [
    'tlv2-ui',
    '@nuxt/devtools',
    // '@nuxt/test-utils/module',
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

  // bugs
  build: {
    transpile: [
      'tslib', // https://github.com/nuxt/nuxt/issues/19265#issuecomment-1702014262
      '@vue/apollo-composable',
      '@apollo/client',
      'protomaps-themes-base'
    ]
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
    // bug https://github.com/nuxt/nuxt/issues/13247
    optimizeDeps: {
      include: [
        'zen-observable',
        'fast-json-stable-stringify',
        'maplibre-gl',
        'haversine',
        '@mapbox/mapbox-gl-draw',
        'cytoscape',
        'mixpanel-browser'
      ]
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
  },
  tlv2: {
    useProxy: false,
    bulma: '~/assets/main.scss',
  },
})