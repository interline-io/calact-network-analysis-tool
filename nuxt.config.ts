// https://nuxt.com/docs/api/configuration/nuxt-config
import 'dotenv/config'
import { defineNuxtConfig } from 'nuxt/config'

const isDev = process.env.NODE_ENV === 'development'

export default defineNuxtConfig({
  modules: [
    '@interline-io/tlv2-auth',
    '@nuxt/eslint',
    '@nuxt/devtools',
  ],

  ssr: false,

  devtools: {
    enabled: isDev,
  },

  css: [
    '@mdi/font/css/materialdesignicons.css',
    '~/assets/main.scss',
  ],

  runtimeConfig: {
    auth0: {
      domain: '',
      clientId: '',
      clientSecret: '',
      sessionSecret: '',
      appBaseUrl: '',
      audience: '',
    },
    tlv2: {
      graphqlApikey: '',
      proxyBase: {
        default: '',
      },
    },
    public: {
      tlv2: {
        protomapsApikey: ''
      },
    },
  },

  build: {
    transpile: ['@interline-io/tlv2-auth', '@interline-io/catenary'],
  },

  compatibilityDate: '2025-02-14',

  vite: {
    server: {
      fs: {
        allow: isDev ? ['../tlv2-apps', '../catenary'] : [],
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

  tlv2Auth: {
    loginGate: true,
    requireLogin: true,
    autoAppBaseUrl: true
  },
})
