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

  runtimeConfig: {
    tlv2: {
      graphqlApikey: '',
      proxyBase: {
        default: '',
        stationEditor: '',
        feedManagement: '',
      },
    },
    public: {
      tlv2: {
        useProxy: true,
        apiBase: {
          default: '',
          stationEditor: '',
          feedManagement: '',
        },
        protomapsApikey: '',
        nearmapsApikey: '',
        auth0Domain: 'https://auth.interline.io',
        auth0ClientId: 'GwwocjhHGFR9dfOv2kFgebRhx79GRh0B',
        auth0RedirectUri: '',
        auth0Audience: 'https://api.transit.land',
        auth0Scope: 'profile email openid',
        loginGate: true,
      },
      web: {
        roles: {
          admin: 'tl_admin',
          downloadCurrentFeedVersion: 'tl_download_fv_current',
          downloadHistoricFeedVersion: 'tl_download_fv_historic',
          saas: 'interline_saas',
          saasStationEditor: 'interline_saas_station_editor',
          saasTransferAnalyst: 'interline_saas_transfer_analyst',
        },
      },
    },
  },

  build: {
    transpile: ['tlv2-ui'],
  },

  routeRules: {
    // We can't disable csurf because it only sets cookie if enabled
    '/**': {
      csurf: {
        methodsToProtect: [],
      },
    },
    '/api/**': {
      csurf: {
        methodsToProtect: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
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

  tlv2: {
    useProxy: true,
    bulma: '~/assets/main.scss',
  },
})
