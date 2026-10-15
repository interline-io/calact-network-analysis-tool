import type { Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { FetchMode } from './useOpenStream'

// This browser's fetch mode, set from the debug menu.
//
// TODO: before direct mode ships, gate the mode on the debug menu or show it
// elsewhere. A browser left in direct mode keeps using direct mode after the
// user turns off debug, and nothing on screen says so.
export const useFetchMode = (): Ref<FetchMode> => {
  return useStorage<FetchMode>('fetchMode', 'bff')
}
