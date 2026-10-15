import type { Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { FetchMode } from './useOpenStream'

// This browser's fetch mode, set from the debug menu.
export const useFetchMode = (): Ref<FetchMode> => {
  return useStorage<FetchMode>('fetchMode', 'bff')
}
