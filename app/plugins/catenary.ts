import CatenaryPlugin from '@interline-io/catenary'
import '@interline-io/catenary/style.css'
import { defineNuxtPlugin } from '#app'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(CatenaryPlugin)
})
