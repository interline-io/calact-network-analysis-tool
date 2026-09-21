// Build provenance for the running app: which environment it was built for,
// which release or commit it came from, and when.
//
// Everything here is resolved once at build time (see nuxt.config.ts) and
// reaches the browser in `runtimeConfig.public.build`. Each environment is its
// own build, so the build is where this provenance actually exists.

export const DEFAULT_BUILD_REPO = 'interline-io/calact-network-analysis-tool'

export type BuildEnvironment = 'production' | 'staging' | 'preview' | 'development'

export interface BuildInfo {
  // Environment this bundle was built for.
  environment: BuildEnvironment
  // Release tag, e.g. "v11". Empty for builds not cut from a release.
  version: string
  // Full commit sha, when known.
  sha: string
  // Branch the build came from, when known.
  branch: string
  // ISO 8601 timestamp of the build, when known.
  builtAt: string
  // GitHub "owner/name", used to build links back to the source.
  repo: string
}

// Values the caller can supply when CI env vars are absent — i.e. local builds,
// where nuxt.config reads the working copy's git state.
export interface BuildInfoFallback {
  sha?: string
  branch?: string
  builtAt?: string
}

export const BUILD_ENVIRONMENT_LABELS: Record<BuildEnvironment, { short: string, long: string }> = {
  production: { short: 'prod', long: 'production' },
  staging: { short: 'staging', long: 'staging' },
  preview: { short: 'preview', long: 'preview' },
  development: { short: 'dev', long: 'development' },
}

export function isBuildEnvironment (value: string | undefined): value is BuildEnvironment {
  return value === 'production' || value === 'staging' || value === 'preview' || value === 'development'
}

// Resolves build provenance from environment variables, in priority order:
//
//  1. NAT_BUILD_* — set explicitly by our GitHub Actions deploy workflows.
//  2. CF_PAGES_* — set automatically by Cloudflare Pages' git-integration
//     builds, which serve per-branch previews.
//  3. GITHUB_* — anything else running in Actions.
//  4. `fallback` — the local working copy.
export function resolveBuildInfo (
  env: Record<string, string | undefined>,
  fallback: BuildInfoFallback = {}
): BuildInfo {
  let environment: BuildEnvironment = 'development'
  if (isBuildEnvironment(env.NAT_BUILD_ENVIRONMENT)) {
    environment = env.NAT_BUILD_ENVIRONMENT
  } else if (env.CF_PAGES) {
    // Cloudflare builds every pushed branch; only main stands in for staging.
    environment = env.CF_PAGES_BRANCH === 'main' ? 'staging' : 'preview'
  }
  return {
    environment,
    version: env.NAT_BUILD_VERSION || '',
    sha: env.NAT_BUILD_SHA || env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || fallback.sha || '',
    branch: env.NAT_BUILD_BRANCH || env.CF_PAGES_BRANCH || env.GITHUB_REF_NAME || fallback.branch || '',
    builtAt: env.NAT_BUILD_TIME || fallback.builtAt || '',
    repo: env.NAT_BUILD_REPO || env.GITHUB_REPOSITORY || DEFAULT_BUILD_REPO,
  }
}

export function shortSha (sha: string): string {
  return sha.slice(0, 7)
}

// Short identifier for the build: the release tag when there is one, otherwise
// the commit it was built from.
export function buildVersionLabel (info: BuildInfo): string {
  if (info.version) {
    return info.version
  }
  if (info.sha) {
    return shortSha(info.sha)
  }
  return ''
}

// Link back to whatever best identifies this build on github.com.
export function buildGithubUrl (info: BuildInfo): string {
  const base = `https://github.com/${info.repo || DEFAULT_BUILD_REPO}`
  if (info.version) {
    return `${base}/releases/tag/${info.version}`
  }
  if (info.sha) {
    return `${base}/commit/${info.sha}`
  }
  return base
}

// "2026-09-10 23:33 UTC" — enough to tell two builds apart, without pulling in
// a formatting dependency.
export function formatBuildTime (builtAt: string): string {
  const parsed = new Date(builtAt)
  if (!builtAt || Number.isNaN(parsed.getTime())) {
    return ''
  }
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// One-line description used for the sidebar tooltip and the non-production
// banner, e.g. "Staging build — main@1ffbe57, built 2026-09-10 23:33 UTC".
export function buildSummary (info: BuildInfo): string {
  const { long } = BUILD_ENVIRONMENT_LABELS[info.environment]
  const environment = `${long.charAt(0).toUpperCase()}${long.slice(1)} build`
  const parts: string[] = []
  if (info.version) {
    parts.push(info.version)
    if (info.sha) {
      parts.push(`commit ${shortSha(info.sha)}`)
    }
  } else if (info.sha) {
    parts.push(info.branch ? `${info.branch}@${shortSha(info.sha)}` : shortSha(info.sha))
  }
  const builtAt = formatBuildTime(info.builtAt)
  if (builtAt) {
    parts.push(`built ${builtAt}`)
  }
  if (parts.length === 0) {
    return environment
  }
  return `${environment} — ${parts.join(', ')}`
}
