// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { defineNuxtConfig } from 'nuxt/config'

const isDev = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({
  modules: [
    'tlv2-ui',
    '@nuxt/eslint',
    '@nuxt/devtools',
  ],

  ssr: false,

  devtools: {
    enabled: isDev,
  },

  css: ['~/assets/main.scss'],

  runtimeConfig: {
    tlv2: {
      graphqlApikey: '',
      proxyBase: {
        default: '',
      },
    },
    public: {
      tlv2: {
        useProxy: true,
        apiBase: {
          default: '',
        },
        protomapsApikey: '',
        auth0Domain: 'https://auth.interline.io',
        auth0ClientId: 'GwwocjhHGFR9dfOv2kFgebRhx79GRh0B',
        auth0RedirectUri: '',
        auth0Audience: 'https://api.transit.land',
        auth0Scope: 'profile email openid',
        loginGate: true,
        requireLogin: true,
      },
    },
  },

  build: {
    transpile: ['tlv2-ui'],
  },

  routeRules: {
    '/**': {
      csurf: {
        methodsToProtect: [],
      },
    },
  },

  compatibilityDate: '2025-02-14',

  vite: {
    server: {
      fs: {
        allow: isDev ? ['../tlv2-ui'] : [],
      },
    },
  },

  typescript: {
    typeCheck: true,
    strict: true,
    tsConfig: {
      vueCompilerOptions: {
        // This is critical for checking component props in templates
        strictTemplates: true,
      },
    },
  },

  tlv2: {
    useProxy: true,
    bulma: '~/assets/main.scss',
  },
})
