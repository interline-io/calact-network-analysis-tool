/**
 * Composable for managing analysis results state
 * Provides a centralized way to track which analyses have results
 */

export function useAnalysisResults () {
  const hasResultsState = useState<Record<string, boolean>>('analysis-has-results', () => ({}))

  const setHasResults = (analysisType: string, hasResults: boolean) => {
    hasResultsState.value[analysisType] = hasResults
  }

  const hasAnyResults = computed(() => {
    return Object.values(hasResultsState.value).some(Boolean)
  })

  const clearAllResults = () => {
    hasResultsState.value = {}
  }

  return {
    hasResultsState: readonly(hasResultsState),
    setHasResults,
    hasAnyResults,
    clearAllResults
  }
}
