import {
  BUILD_ENVIRONMENT_LABELS,
  buildGithubUrl,
  buildSummary,
  buildVersionLabel,
  type BuildInfo,
} from '~~/src/core'

// Build provenance captured at build time (see nuxt.config.ts).
// These values never change while the app is running, so they are returned as
// plain values rather than refs.
export const useBuildInfo = () => {
  const info = useRuntimeConfig().public.build as BuildInfo
  const labels = BUILD_ENVIRONMENT_LABELS[info.environment] ?? BUILD_ENVIRONMENT_LABELS.development
  return {
    info,
    isProduction: info.environment === 'production',
    environmentLabel: labels.long,
    environmentShortLabel: labels.short,
    versionLabel: buildVersionLabel(info),
    summary: buildSummary(info),
    githubUrl: buildGithubUrl(info),
  }
}
