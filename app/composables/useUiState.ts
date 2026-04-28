import { ref, type Ref } from 'vue'

// Local UI flags that aren't worth persisting to the URL but are read or
// written by more than one component. Module-level so every caller sees the
// same ref (the app is SSR-disabled, so a single shared instance is fine).
const showBbox = ref(true)

interface UiState {
  showBbox: Ref<boolean>
}

export function useUiState (): UiState {
  return { showBbox }
}
