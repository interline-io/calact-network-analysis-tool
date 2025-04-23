import { useStorage } from '@vueuse/core'

export const useDebugMenu = ():Ref<boolean> => {
    const useDebugValue = useStorage('debug', false)
    return useDebugValue
}
