# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CALACT Network Analysis Tool — a Nuxt 4 (Vue 3) SPA for browsing, analyzing, and visualizing transit networks across California, Oregon, and Washington. Built for CALACT and partner agencies (ODOT, WSDOT). Users query transit data (stops, routes, schedules, flex services) through a geographic interface with filtering, analysis, and reporting. Uses TypeScript with strict mode and strict Vue templates.

## Commands

```bash
pnpm dev          # Dev server at localhost:3000
pnpm build        # Production build
pnpm start        # Launch production server
pnpm lint         # ESLint (flat config with tlv2-ui rules)
pnpm test         # Vitest with coverage (single run)
pnpm test:watch   # Vitest in watch mode
pnpm check        # Lint (with --fix) + typecheck
pnpm calact       # Run CLI tool (tsx src/cli/calact.ts)
```

To use a local copy of tlv2-ui: run `pnpm link ../tlv2-ui` here and `pnpm run dev:prepare` in tlv2-ui.

## Architecture

### Framework & Config
- **Nuxt 4** with SSR disabled (`ssr: false`) — runs as an SPA
- **TypeScript strict mode** with `strictTemplates: true` for Vue template prop checking
- **Bulma CSS** via SCSS (`app/assets/main.scss`)
- **Node.js v20** (see `.nvmrc`)
- **Auth0** login gate with role `tl_calact_nat` required for access

### Key Module: tlv2-ui
The `@interline-io/tlv2-ui` package (installed from GitHub Packages or git URL; both supported) is the shared UI library providing:
- Vue components (`t-loading`, `t-notification`, `t-icon`, `tl-login-gate`, MapLibre GL map viewer)
- GraphQL query infrastructure and API proxy configuration
- ESLint stylistic and TypeScript rule configs
- Auth0 integration and role-based access control

### Data Flow
- **Transitland GraphQL API** is the primary data source, accessed through tlv2-ui's proxy system
- Frontend sends scenario parameters (bbox, date range, filters) to **server API routes** (`server/api/`)
- Server routes invoke core logic in `src/scenario/` and `src/analysis/` to fetch and process data
- Results stream back to the client as **NDJSON** (newline-delimited JSON) via `ReadableStream`
- Frontend renders results on MapLibre GL maps and data grids with filtering, export (CSV/GeoJSON), and reporting

### Directory Structure
- `app/pages/` — File-based routes: `index.vue` (home), `tne.vue` (Transit Network Explorer — the main app), `help.vue`, `admin/profile.vue`
- `app/components/cal/` — Main UI: query builder, map, data grid, filtering, reports, CSV/GeoJSON download, map sharing
- `app/components/analysis/` — Analysis-specific views: WSDOT service levels, WSDOT stops/routes, VisionEval
- `app/composables/` — `useApiFetch` (HTTP + Auth0 tokens), `useTransitlandApiEndpoint`, `useAnalysisResults`, `useFlexAreaFormatting`, `useDebugMenu`
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

## Code Conventions
- Vue 3 Composition API with `<script setup lang="ts">`
- 2-space indentation, LF line endings
- ESLint rules from tlv2-ui (`eslintStylisticRules`, `eslintTypescriptRules`)
- Always use braces `{}` for `if`/`for`/`while` blocks — never single-line returns without braces
- Tests use `filename.test.ts` pattern alongside source files in `src/`
- Package manager: pnpm (v10.x)

## Environment Variables

See `.env.example`. Key variables:
- `TRANSITLAND_API_BASE` — GraphQL API endpoint (used by CLI)
- `NUXT_TLV2_PROXY_BASE_DEFAULT` — API proxy base URL
- `NUXT_PUBLIC_TLV2_PROTOMAPS_APIKEY` — Map tiles API key
- `NUXT_PUBLIC_TLV2_LOGIN_GATE` / `NUXT_PUBLIC_TLV2_REQUIRE_LOGIN` — Set to `true` to test production auth behavior

## PR Summary

When asked to "generate PR summary", run `git diff main...HEAD` and `git log main..HEAD --oneline` to analyze all changes on the current branch, then output a GitHub-flavored markdown PR description wrapped in a fenced code block so it can be copy-pasted. No emojis, no checklists. Use this structure:

```
## Summary
<high-level one paragraph description of the PR>

### <theme 1>
<bulleted details>

### <theme 2>
<bulleted details>

## Test plan
<manual verification steps relevant to the changes; do not include pnpm test/lint/typecheck as those are handled by CI>
```
