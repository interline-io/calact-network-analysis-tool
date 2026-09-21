import {
  buildCommitUrl,
  buildGithubUrl,
  formatBuildTime,
  shortSha,
  type BuildInfo,
} from '~~/src/core'

// Build provenance captured at build time (see nuxt.config.ts). These values
// never change while the app is running, so they are returned as plain values
// rather than refs.
export const useBuildInfo = () => {
  const info = useRuntimeConfig().public.build as BuildInfo
  return {
    info,
    isProduction: info.environment === 'production',
    environmentLabel: info.environment,
    shortSha: shortSha(info.sha),
    builtAtLabel: formatBuildTime(info.builtAt),
    githubUrl: buildGithubUrl(info),
    commitUrl: buildCommitUrl(info),
  }
}
