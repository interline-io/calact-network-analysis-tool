import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BUILD_REPO,
  buildCommitUrl,
  buildGithubUrl,
  formatBuildTime,
  isBuildEnvironment,
  resolveBuildInfo,
  shortSha,
  type BuildInfo,
} from './build-info'

const sha = '1ffbe57d9c0b4f2a8e6d5c4b3a2918f0e7d6c5b4'

describe('resolveBuildInfo', () => {
  it('uses the explicit NAT_BUILD_* values set by our deploy workflows', () => {
    const info = resolveBuildInfo({
      NAT_BUILD_ENVIRONMENT: 'production',
      NAT_BUILD_VERSION: 'v11',
      NAT_BUILD_SHA: sha,
      NAT_BUILD_BRANCH: 'main',
      NAT_BUILD_TIME: '2026-09-10T23:33:36Z',
      GITHUB_REPOSITORY: 'interline-io/calact-network-analysis-tool',
    })
    expect(info).toEqual({
      environment: 'production',
      version: 'v11',
      sha,
      branch: 'main',
      builtAt: '2026-09-10T23:33:36Z',
      repo: 'interline-io/calact-network-analysis-tool',
    })
  })

  it('treats a Cloudflare build of main as staging', () => {
    const info = resolveBuildInfo({
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'main',
      CF_PAGES_COMMIT_SHA: sha,
    })
    expect(info.environment).toBe('staging')
    expect(info.branch).toBe('main')
    expect(info.sha).toBe(sha)
    expect(info.version).toBe('')
  })

  it('treats a Cloudflare build of any other branch as a preview', () => {
    const info = resolveBuildInfo({
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'stop-geography-phase',
      CF_PAGES_COMMIT_SHA: sha,
    })
    expect(info.environment).toBe('preview')
    expect(info.branch).toBe('stop-geography-phase')
  })

  it('falls back to the local working copy outside CI', () => {
    const info = resolveBuildInfo({}, { sha, branch: 'main', builtAt: '2026-09-21T10:00:00Z' })
    expect(info).toEqual({
      environment: 'development',
      version: '',
      sha,
      branch: 'main',
      builtAt: '2026-09-21T10:00:00Z',
      repo: DEFAULT_BUILD_REPO,
    })
  })

  it('ignores an unrecognized environment name', () => {
    const info = resolveBuildInfo({ NAT_BUILD_ENVIRONMENT: 'qa', CF_PAGES: '1', CF_PAGES_BRANCH: 'main' })
    expect(info.environment).toBe('staging')
  })

  it('prefers CI env vars over the local fallback', () => {
    const info = resolveBuildInfo(
      { GITHUB_SHA: sha, GITHUB_REF_NAME: 'v11' },
      { sha: 'aaaaaaaaaaaa', branch: 'some-local-branch' }
    )
    expect(info.sha).toBe(sha)
    expect(info.branch).toBe('v11')
  })
})

describe('isBuildEnvironment', () => {
  it('accepts the four known environments and rejects anything else', () => {
    expect(isBuildEnvironment('production')).toBe(true)
    expect(isBuildEnvironment('staging')).toBe(true)
    expect(isBuildEnvironment('preview')).toBe(true)
    expect(isBuildEnvironment('development')).toBe(true)
    expect(isBuildEnvironment('qa')).toBe(false)
    expect(isBuildEnvironment(undefined)).toBe(false)
  })
})

describe('build labels and links', () => {
  const release: BuildInfo = {
    environment: 'production',
    version: 'v11',
    sha,
    branch: 'main',
    builtAt: '2026-09-10T23:33:36Z',
    repo: DEFAULT_BUILD_REPO,
  }
  const staging: BuildInfo = {
    environment: 'staging',
    version: '',
    sha,
    branch: 'main',
    builtAt: '2026-09-21T10:00:00Z',
    repo: DEFAULT_BUILD_REPO,
  }
  const unknown: BuildInfo = {
    environment: 'development',
    version: '',
    sha: '',
    branch: '',
    builtAt: '',
    repo: DEFAULT_BUILD_REPO,
  }

  it('links to the release, the commit, or the repo', () => {
    expect(buildGithubUrl(release)).toBe(`https://github.com/${DEFAULT_BUILD_REPO}/releases/tag/v11`)
    expect(buildGithubUrl(staging)).toBe(`https://github.com/${DEFAULT_BUILD_REPO}/commit/${sha}`)
    expect(buildGithubUrl(unknown)).toBe(`https://github.com/${DEFAULT_BUILD_REPO}`)
  })

  it('always links the commit separately from the release', () => {
    expect(buildCommitUrl(release)).toBe(`https://github.com/${DEFAULT_BUILD_REPO}/commit/${sha}`)
    expect(buildCommitUrl(staging)).toBe(`https://github.com/${DEFAULT_BUILD_REPO}/commit/${sha}`)
    expect(buildCommitUrl(unknown)).toBe('')
  })

  it('shortens shas and drops unusable timestamps', () => {
    expect(shortSha(sha)).toBe('1ffbe57')
    expect(shortSha('')).toBe('')
    expect(formatBuildTime('')).toBe('')
    expect(formatBuildTime('not a date')).toBe('')
    expect(formatBuildTime('2026-09-10T23:33:36Z')).toBe('2026-09-10 23:33 UTC')
  })
})
