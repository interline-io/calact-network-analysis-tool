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
        default: 'proxy',
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

  hooks: {
    // @interline-io/tlv2-auth wraps @auth0/auth0-nuxt, and both register a
    // `useUser` auto-import. Nuxt already keeps tlv2-auth's (our wrapper) and
    // only warns about the duplicate; drop the auth0-nuxt entry so there's a
    // single source and the warning goes away. Behavior is unchanged.
    'imports:extend' (imports) {
      for (let i = imports.length - 1; i >= 0; i--) {
        if (imports[i]!.name === 'useUser' && imports[i]!.from.includes('auth0-nuxt')) {
          imports.splice(i, 1)
        }
      }
    },
  },

  tlv2Auth: {
    loginGate: true,
    requireLogin: true,
    proxyEnabled: true,
    autoAppBaseUrl: true
  },
})
