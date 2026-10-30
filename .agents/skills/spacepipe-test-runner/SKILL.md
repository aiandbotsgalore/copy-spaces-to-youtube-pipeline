---
name: spacepipe-test-runner
description: Runs and diagnoses SpacePipe Gen tests, including Vitest unit tests, Playwright acceptance tests, TypeScript compilation, and Vite production builds. Use when testing code changes, verifying templates, or diagnosing CI/build failures.
---

# SpacePipe Test Runner & Diagnostic Guide

## Available Test Suites

| Command | Tool | Purpose |
| :--- | :--- | :--- |
| `npm run typecheck` | TypeScript Compiler (`tsc --noEmit`) | Strict type checking across React components, template generators, and contracts. |
| `npm run test` | Vitest | Fast unit tests for Zod contracts, utility helpers, template rendering, and state management. |
| `npm run acceptance` | Vitest / Playwright (`vitest.acceptance.config.ts`) | End-to-end integration and acceptance tests for pipeline generation and UI flows. |
| `npm run build` | Vite (`vite build`) | Verifies production bundling, CSS compilation with Tailwind v4, and asset resolution. |

## Standard Verification Routine

When completing features or modifying generators:

1. **Type Check First:**
   ```bash
   npm run typecheck
   ```
   Ensures no schema discrepancies between `types.ts`, `utils/contracts/`, and template functions.

2. **Run Unit Tests:**
   ```bash
   npm run test
   ```
   Tests individual template generation functions in `utils/templates/` and parsing routines.

3. **Run Acceptance Tests:**
   ```bash
   npm run acceptance
   ```
   Validates full pipeline generator outputs against golden snapshots and acceptance criteria.

4. **Production Build Validation:**
   ```bash
   npm run build
   ```
   Ensures that Vite bundles clean code to `dist/` without unresolved imports.

## Common Issues & Troubleshooting

- **Tailwind v4 syntax errors:** Vite uses `@tailwindcss/vite` and `@import "tailwindcss"` in `index.css`. Do not add legacy `tailwind.config.js` plugins without verifying v4 compatibility.
- **Zod contract failures:** When reading external `releases.json` or `clips_catalog.json`, use safe parsing helpers like `parseClipCatalog()` in `utils/contracts/clipCatalog.ts` to prevent unexpected crashes on malformed data.
