# Engineering Guide

Use this as the compact engineering contract for future agents. Product intent lives in `AGENTS.md`; durable why lives in `DECISIONS.md`; active handoff lives in `NEXT.md`.

## Folder Structure

- `src/app/`: Angular UI components, services, models, and utility logic.
- `lib/`: reusable Node APIs for scanner, runtime, and CLI consumers.
- `scripts/`: scanner implementation, audits, tests, packaging, verification, and release helpers.
- `bin/`: npm CLI entrypoint.
- `vscode-extension/`: VS Code extension host, manifest, media, and build config.
- `docs/`: product, data, schema, deployment, extension, and scanner documentation.
- `data/`: committed reference data such as pricing and VS Code schema baseline.
- `public/`: static browser assets.
- `tmp/`: generated local artifacts; do not commit unless explicitly intended.

## Architectural Patterns

- One scanner implementation serves CLI, local runtime, npm/browser host, and VS Code extension.
- `lib/scanner-api.mjs` is the stable scanner host boundary.
- `lib/local-runtime.mjs` hosts cached session data, refresh/status endpoints, scan cancellation, and static UI.
- Angular consumes normalized `SessionData`; it should not parse raw VS Code logs.
- VS Code extension starts the shared runtime, injects host config, and opens the compiled Angular app in a webview.
- Extension-specific context should come from VS Code APIs/settings where available, not guessed from broad filesystem traversal.
- Scanner internals are split by concern:
  - traversal
  - workspace orchestration
  - session parsing
  - memory import
  - customization inventory
  - customization evidence
  - schema audit
  - pricing helpers

## Angular Conventions

- Use standalone components with local `imports`.
- Keep `.ts`, `.html`, and `.css` files beside each component.
- Use Angular signals for local state and `computed()` for derived state.
- Use `@Input()` setters to normalize nullable external inputs into signals.
- Use `@Output()` events for parent actions.
- Use `@for` with explicit tracking and `@if` for conditional template blocks.
- Keep page-level state in `App` only when it coordinates pages, filters, selected sessions, or host behavior.
- Keep shared analysis in utility modules instead of duplicating calculations in templates.

## State Management

- No external global state library is used.
- `SessionDataService` owns loaded session data, load state, refresh state, runtime status, and scan actions.
- Component state is mostly signals and computed values.
- Runtime state comes from `/api/status` when the local runtime is available.
- Static mode falls back to `/data/sessions.json`.

## Naming Conventions

- Angular components: `feature-name.component.ts/html/css`.
- Specs: colocated `*.spec.ts` for Angular and `*.test.mjs` for Node scripts.
- Scanner modules: `scanner-*.mjs`.
- Session-domain types use explicit names such as `CopilotSession`, `TraceEvent`, `TokenBreakdown`, and `SourceUsage`.
- Union types describe finite UI and data states, such as `SessionDataLoadState`, `TraceFilter`, and `SessionSize`.

## Preferred Coding Style

- TypeScript should be explicit and typed; prefer typed unions over loose strings.
- Keep functions small enough to test when they encode data semantics.
- Prefer pure utility functions for analytics, pricing, and session analysis.
- In Node scripts, use ESM imports and async functions.
- Keep comments for non-obvious contracts, source limitations, or privacy-sensitive behavior.
- Avoid committing machine-specific generated outputs.

## Error Handling

- Surface refresh and load failures through user-visible state, not console-only logs.
- Preserve last valid runtime data when a scan fails or is stopped.
- Treat missing local runtime as static-only mode where possible.
- Do not hide fallback pricing, partial scan results, or weak evidence.
- Use bounded diagnostics and friendly labels in UI; raw details belong behind details panels or logs.
- Long scans must show progress, elapsed time, and a clear stop/failure/partial/complete state.

## Performance Considerations

- Avoid broad recursive filesystem scans.
- Scan known VS Code storage and trusted customization locations.
- Debounce or serialize scans; scanner API allows only one scan at a time per Node process.
- Keep large-profile scans cancellable, bounded, and diagnosable.
- Keep raw trace and evidence payloads bounded.
- Watch Angular bundle and CSS budgets; current build has budget pressure.

## Privacy Rules

- Do not commit generated `sessions.json` files from a real machine unless they are deliberate sanitized fixtures.
- Do not commit raw prompts, responses, tool arguments, tool results, memories, plans, local absolute paths, or private debug logs.
- Fixtures must be small, synthetic, and privacy-safe.
- Diagnostics shown in the UI should help debugging without exposing full private payloads by default.

## Verification Commands

- App tests: `npm test -- --watch=false`
- Node/scanner tests: `npm run test:scripts`
- Production build: `npm run build`
- Generated data verification: `npm run verify:data`
- Schema audit: `npm run schema:audit`
- VS Code extension typecheck: `npm run vscode:typecheck`
- VS Code extension package: `npm run vscode:package`

Run the smallest relevant set for the change. For release-impacting changes, run scripts tests, Angular tests, production build, and VSIX packaging.
