// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { stylisticConfig } from 'tlv2-ui/config'

const isDev = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({

  modules: [
    'tlv2-ui',
    '@nuxt/devtools',
    'nuxt-csurf',
    // '@nuxt/test-utils/module',
    '@nuxt/eslint',
  ],
  ssr: false,

  devtools: {
    enabled: isDev
  },

  runtimeConfig: {
    tlv2: {
      proxyBase: '', // can be overridden by NUXT_PROXY_BASE environment variable
      graphqlApikey: '',
    },
    public: {
      tlv2: {
        apiBase: '', // can be overridden by NUXT_PUBLIC_API_BASE environment variable
        protomapsApikey: '',
        nearmapsApikey: '',
        auth0Domain: '',
        auth0ClientId: '',
        auth0RedirectUri: '',
        auth0Audience: '',
        auth0Scope: '',
        loginGate: '',
        // requireLogin: '',
      }
    }
  },

  // bugs
  build: {
    transpile: [
      'tslib', // https://github.com/nuxt/nuxt/issues/19265#issuecomment-1702014262
      '@vue/apollo-composable',
      '@apollo/client',
      'protomaps-themes-base',
      'tlv2-ui', // Required for yarn link development + ESM compatibility
      'h3' // Required for type safety + ESM compatibility with H3Event, getHeader, createError
    ]
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
    useProxy: true,
    bulma: '~/assets/main.scss',
  },
})
