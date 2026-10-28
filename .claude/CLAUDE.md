# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CALACT Network Analysis Tool — a Nuxt 4 (Vue 3) SPA for browsing, analyzing, and visualizing transit networks across California, Oregon, and Washington. Built for CALACT and partner agencies (ODOT, WSDOT). Users query transit data (stops, routes, schedules, flex services) through a geographic interface with filtering, analysis, and reporting. Uses TypeScript with strict mode and strict Vue templates.

## Commands

```bash
pnpm dev          # Dev server at localhost:3000
pnpm build        # Production build
pnpm start        # Launch production server
pnpm lint         # ESLint (flat config)
pnpm test         # Vitest with coverage (single run)
pnpm test:watch   # Vitest in watch mode
pnpm check        # Lint (with --fix) + typecheck
pnpm calact       # Run CLI tool (tsx src/cli/calact.ts)
```

To use local copies of dependencies: run `pnpm link ../catenary` or `pnpm link ../tlv2-apps/packages/tlv2-auth` here.

## Architecture

### Framework & Config
- **Nuxt 4** with SSR disabled (`ssr: false`) — runs as an SPA
- **TypeScript strict mode** with `strictTemplates: true` for Vue template prop checking
- **Bulma CSS** via SCSS (`app/assets/main.scss`)
- **Node.js v20** (see `.nvmrc`)
- **Auth0** login gate with role `tl_calact_nat` required for access

### Key Dependencies
- **`@interline-io/catenary`** — Vue 3 UI component library (Bulma-based): buttons, forms, modals, tables, notifications, etc. Registered globally via plugin with `Cat` prefix.
- **`@interline-io/tlv2-auth`** — Nuxt 4 module providing Auth0 server-side sessions, CSRF protection, and API proxy (`/api/proxy/{backend}/...`). Provides `useUser()`, `useLogin()`, `useLogout()`, `useApiEndpoint()` composables.

### Data Flow
- **Transitland GraphQL API** is the primary data source, accessed through tlv2-auth's proxy system
- Frontend sends scenario parameters (bbox, date range, filters) to **server API routes** (`server/api/`)
- Server routes invoke core logic in `src/scenario/` and `src/analysis/` to fetch and process data
- Results stream back to the client as **NDJSON** (newline-delimited JSON) via `ReadableStream`
- Frontend renders results on MapLibre GL maps and data grids with filtering, export (CSV/GeoJSON), and reporting

### State ownership & data flow
- Data fetching lives in the container page (`app/pages/tne.vue`) or composables it calls. The main scenario results stream in from the `/api/scenario` endpoint as NDJSON over `fetch` — the Transitland GraphQL queries run **server-side** in `server/api/` → `src/scenario`, not via client Apollo. Supporting data fetched client-side with Apollo `useQuery` (census layers, choropleth/buffer geometry, viewport geographies) is kept here too. Fetched and derived results flow down to child components as plain props.
- The main data-flow components (filter, report, map, census panel) — and any composables/helpers they use — must be driveable from plain props, so they render and test without a live scenario stream or a seeded Apollo cache. Composables/helpers that *process props or derive new values from props* are fine anywhere; the constraint is no fetching or direct Apollo-cache access (nothing that can't be passed in as plain data).
- Exception: the URL-backed `useScenario*` composables (`useScenarioInputs` / `useScenarioFilters` / `useScenarioDisplay`) may be called by any component — they read the route query, which is trivial to provide in a test. (Subject to revisiting.)
- Exception: self-contained interactive widgets that fetch their own options — the feed-version and census-dataset pickers, and query.vue's geography typeahead — may own their Apollo queries; their data isn't part of the scenario-result graph.
- Keep `tne.vue` as the composition root so the app's data-flow graph is readable in one place.

### Directory Structure
- `app/pages/` — File-based routes: `index.vue` (home), `tne.vue` (Transit Network Explorer — the main app), `help.vue`, `admin/profile.vue`
- `app/components/cal/` — Main UI: query builder, map, data grid, filtering, reports, CSV/GeoJSON download, map sharing
- `app/components/cal/transfer/` — Transfer Analyst: its report, settings, stops and platforms map, and trip tags
- `app/components/analysis/` — Analysis-specific views: WSDOT service levels, WSDOT stops/routes, VisionEval
- `app/composables/` — `useAnalysisResults`, `useFlexAreaFormatting`, `useDebugMenu`, `useToastNotification`
- `app/layouts/` — `default` (sidebar + login-gated content area)
- `src/core/` — Shared utilities: GraphQL client, date/time helpers, geometry, streaming, constants, colors, task queue
- `src/tl/` — Transitland API integration: stops, routes, departures, agencies, feed versions, census geographies, GTFS-Flex
- `src/scenario/` — Scenario data fetching, filtering (by agency, route type, date, time), route headway/frequency calculations
- `src/analysis/` — Analysis modules: `wsdot/` (service levels 1–6), `wsdot-stops-routes/`, `visioneval/`, `ntd/`
- `src/cli/` — CLI entry points for running scenarios and analyses outside the browser
- `server/api/` — Nitro endpoints: `scenario.post.ts`, `wsdot.post.ts`, `visioneval.post.ts`, `examples.get.ts`
- `testdata/` — Test fixtures (GTFS feeds, WSDOT scenario data)
- `public/examples/` — Canned example queries

### Analysis Types
- **Scenario (Browse)**: Explore stops, routes, and schedules within a bounding box and date range
- **WSDOT Service Levels**: Classify routes by service quality (Level 1–6 + night service)
- **WSDOT Stops & Routes**: Detailed stop/route availability analysis
- **VisionEval**: Future scenario planning integration
- **NTD**: National Transit Database reporting

### Key Domain Concepts
- **Scenario**: A query combining geographic bounds (bbox), date range, and configuration (fixed-route/flex toggles, aggregation layer)
- **GTFS-Flex**: Demand-responsive transit support with pickup/dropoff area types and advance notice categories
- **Canned bounding boxes**: Predefined geographic areas (Portland, Seattle, Bend, Eugene, Salem, WA, OR) in `src/core/constants.ts`
- **Census geography integration**: Tract/blockgroup overlays for demographic analysis

## Verifying Changes

After making edits, run `pnpm check` to verify correctness (lint with auto-fix + typecheck). **Always run this before presenting work as done or ready for testing** — never skip the typecheck step.

## Testing against the live server

`docker/docker-compose.services.yaml` runs a real Transitland server (tlserver, built from the transitland-lib commit pinned in `docker/tlserver/tlserver.docker`) on fixture GTFS and census data, published at `localhost:28080`. `cd docker && ./reset-test-services.sh` rebuilds and restores it; `./check-test-services.sh` waits until it's healthy. CI starts the same services before the tests.

**Always `source docker/docker-env.sh` first.** It points the shell at the stack: the GraphQL base the test suite and CLI use, the dev server's API proxy, and the Auth0 gate (off). Source it before `pnpm dev`, `pnpm test`, `pnpm test:browser` or the CLI. Don't hand-set these variables or point a config at another server.

**Never use mocks for what this server covers.** Mocked GraphQL responses have no value here: they only confirm the client sent what it meant to send, and catch nothing the server would reject or answer wrong. Test new API fields, filters and query shapes against the live server, as the integration suites in `src/scenario/scenario-census.test.ts` do. A change that needs a newer transitland-lib bumps the tlserver pin in the same branch. (The outside clip's mocked tests passed while the fixture server rejected `stop_buffer.exclude`.)

## Git & PRs

Never create a PR or merge a PR automatically. Opening and merging PRs is always a 100% manual action by the repo owner. You may prepare branches, commits, and PR descriptions (see "PR Summary" below), but stop short of `gh pr create` or `gh pr merge` unless explicitly instructed in the current turn.

## Working from GitHub issues

Critical information from collaborators is often in the issue follow-up comments, not only the original description. When asked to work on an issue, always read the full comment thread — including wireframes, design mockups, attached images, clarifications, and user feedback — and consider them alongside the original description. Use `gh issue view <num> --comments` and fetch any image attachments (e.g. `curl` the `github.com/user-attachments/...` URLs) so you can view them before planning or implementing.

## Code Conventions
- Vue 3 Composition API with `<script setup lang="ts">`
- 2-space indentation, LF line endings
- ESLint rules inlined in `eslint.config.ts` (stylistic and TypeScript rules)
- Always use braces `{}` for `if`/`for`/`while` blocks — never single-line returns without braces
- Tests use `filename.test.ts` pattern alongside source files in `src/`
- Package manager: pnpm (v10.x)
- CSS class names on our own components are prefixed with `cal-` (e.g. `cal-map-sidebar`, `cal-census-details-header`). Do not introduce unprefixed class names for component-internal styling — they can collide with Bulma, Catenary, or other libraries.
- A major feature's components live in their own directory under `app/components/cal/`, as the Transfer Analyst's do in `cal/transfer/`. Name the files without the directory's prefix: Nuxt prefixes the path, so `cal/transfer/report.vue` is `<cal-transfer-report>`.

## Geometry operations: server-side only

Avoid client-side geometry operations (union, buffer, intersection, difference, area, etc.) — including via turf.js or any other JS geometry library. These libraries are not production-grade and cannot be trusted to agree closely with the calculations done in PostGIS on the backend. Always perform geometric work server-side via the Transitland GraphQL API (e.g. `stop_buffer`, `intersection_area`, `intersection_geometry`) and consume the results on the client. If a feature appears to require client-side geometry, treat that as a signal to extend the backend or adjust the design — not to introduce client-side geometric math.

**Exception:** computing a bounding box around features client-side (min/max of coordinates, e.g. `@turf/bbox` or hand-rolled) is fine — it's arithmetic, not a geometric calculation, and the result only needs to be approximate (e.g. for padding a query area or framing a map view). The ban is on operations whose correctness depends on agreeing with PostGIS.

## GraphQL documents: static literals only

Every GraphQL query is a static `gql` literal, with its values passed as variables. Never build a document at runtime: no generated aliases, repeated fields, field lists, fragments or variable declarations, and no `gql(…)` called on an assembled string, even when only indices vary. This is absolutely forbidden. When one request can't express what a feature needs, the API lacks a capability: add it in transitland-lib, with a tlserver pin bump, or send one static request per item.

## Transitland operators: not without review

calact works with GTFS agencies (`agency` on routes, `agencies` on feed versions) and never with Transitland's operator concept. That covers the GraphQL `Operator` type and everything that reaches one: `operators` queries, `Agency.operator`, `Feed.associated_operators`, and operator Onestop IDs, including `operator_onestop_id` filters and `Agency.onestop_id`, which can hold its operator's ID. Bringing in any of them needs a serious discussion with the repo owner and vetting first; don't add one on your own initiative, even where it looks like a better fit than agencies.

## Environment Variables

Interline doesn't use `.env` files: Nuxt loads one on its own, so a stray file silently changes which server the app uses. Set the environment from sources you load on purpose: `source docker/docker-env.sh` for the local docker stack, and 1Password environments for API keys. Key variables:
- `TRANSITLAND_API_BASE` — GraphQL API endpoint (used by CLI)
- `NUXT_TLV2PROXY_BACKENDS_DEFAULT_BASE` / `NUXT_TLV2PROXY_BACKENDS_DEFAULT_APIKEY` — Transitland API base URL and apikey, for the proxy and the server API
- `NUXT_PUBLIC_TLV2_PROTOMAPS_APIKEY` — Map tiles API key
- `NUXT_PUBLIC_TLV2_LOGIN_GATE` / `NUXT_PUBLIC_TLV2_REQUIRE_LOGIN` — Set to `true` to test production auth behavior

## PR Summary

When asked to "generate PR summary", run `git diff main...HEAD` and `git log main..HEAD --oneline` to analyze all changes on the current branch, then output a GitHub-flavored markdown PR description wrapped in a fenced code block so it can be copy-pasted. No emojis, no checklists. Use this structure:

```
## Summary
<high-level one paragraph description of the PR>

## User-facing changes
<high-level description of changes to user interface, less focused on code details>

### <user-facing changes theme 1>
<bulleted list of user-facing changes>

### <user-facing changes theme 2>
<bulleted list of user-facing changes>

## Implementation details

### <theme 1>
<bulleted details>

### <theme 2>
<bulleted details>

## User test plan
<manual verification steps relevant to the changes; do not include pnpm test/lint/typecheck as those are handled by CI>
```
