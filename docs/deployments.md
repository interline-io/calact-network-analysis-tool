# Deployments

## Environments

| Environment | Built by | Cloudflare Pages project | URL |
| --- | --- | --- | --- |
| Production | `.github/workflows/deploy-production.yml`, on `release: published` (or manual dispatch) | `calact-network-analysis-tool-prod` | production domain |
| Staging | `.github/workflows/deploy-staging.yml`, on every push to `main` | `calact-network-analysis-tool`, branch `main` | https://main.calact-network-analysis-tool.pages.dev |
| Preview | Cloudflare Pages git integration, on every pushed branch | `calact-network-analysis-tool`, per branch | `https://<branch-truncated-to-28-chars>.calact-network-analysis-tool.pages.dev` |

Both deploy workflows declare a job `environment:`, so GitHub records a
Deployment and a deployment status for each run. "What is live where" is then
visible in the repo's Environments view, or via
`gh api repos/interline-io/calact-network-analysis-tool/deployments`.

## Release notes

Releases are cut by hand (tags `v1`, `v2`, …). When a release is published with
an empty body, the `release-notes` job in the production workflow calls GitHub's
`generate-notes` API and fills the body in with the merged pull requests since
the previous tag. A body written by hand is never overwritten.

Notes are generated from pull request titles. To group them into sections, add
labels to pull requests and a `.github/release.yml` with matching categories.

## Build provenance in the app

`src/core/build-info.ts` resolves which environment, release, and commit a
build came from; `nuxt.config.ts` calls it at build time and puts the result in
`runtimeConfig.public.build`, which reaches the browser with the SPA shell.
Each environment is its own build, so the build is where this provenance
exists.

Sources, in priority order:

1. `NAT_BUILD_ENVIRONMENT` / `NAT_BUILD_VERSION` / `NAT_BUILD_SHA` /
   `NAT_BUILD_BRANCH` / `NAT_BUILD_TIME` / `NAT_BUILD_REPO`, set by the deploy
   workflows.
2. `CF_PAGES*`, set automatically by Cloudflare Pages git-integration builds. A
   build of `main` is labeled staging, any other branch preview.
3. `GITHUB_SHA` / `GITHUB_REF_NAME` / `GITHUB_REPOSITORY`.
4. The local working copy's git state, for `pnpm dev` and local builds.

The app surfaces this in two places (`useBuildInfo`):

- `cal-build-info` — an "About this build" table on `/help`, listing the
  environment, release tag, commit, and build time, linking to that release and
  commit on github.com.
- `cal-build-banner` — a dismissible warning shown only on non-production
  builds, across every page. Dismissal is remembered per commit, so it returns
  after a redeploy.

## One-time setup

- **Cloudflare**: turn off automatic deployments for the production branch
  (`main`) of the `calact-network-analysis-tool` project. Otherwise Cloudflare's
  git integration and the staging workflow both publish to the same `main`
  alias and race each other. Per-branch preview builds stay on.
- **GitHub**: the `production` and `staging` environments are created on the
  first workflow run; add protection rules there if production deploys should
  require a reviewer.
- **Secrets**: staging uses the same repository secrets as production
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `NUXT_PUBLIC_TLV2_PROTOMAPS_APIKEY`, `NUXT_AUTH0_CLIENT_ID`). To give staging
  a different Auth0 client or Protomaps key, define those as environment-scoped
  secrets on the `staging` environment — they take precedence over the
  repository-level ones.
