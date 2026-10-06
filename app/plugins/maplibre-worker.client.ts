import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { defineNuxtPlugin } from '#imports'

// maplibre-gl v6 is ESM-only and resolves its worker relative to import.meta.url,
// which does not survive bundling. Point it at the worker chunk Vite emits.
export default defineNuxtPlugin(() => {
  setWorkerUrl(workerUrl)
})
