# Handoff Notes

Use this file for short-lived current-state context. Keep durable product rules in `AGENTS.md`, engineering rules in `ENGINEERING.md`, and durable decisions in `DECISIONS.md`.

## Current Project Status

- Early VS Code extension preview.
- npm/browser host remains available for development and fallback testing.
- Core app pages exist: Usage, Sessions, Memory, Customizations preview, Compare, Insights, and Prices.
- Scanner imports local VS Code Copilot sessions, debug logs, chat snapshots, memories, plans, and customization evidence.
- Local runtime supports refresh, status, cancellation, logs, cached data, and static app delivery.
- Current branch includes extension-first release polish, pricing/schema maintenance, and documentation updates.

## Current Priorities

- Get extension-first release confidence from real-machine VSIX testing.
- Keep global scan and Customizations evidence scan clearly separated in UI and runtime state.
- Keep Customizations preview conservative, settings-first, and understandable.
- Preserve schema drift resilience for VS Code Agent Debug Logs.
- Track the latest observed schema audit: VS Code 1.127.0 / Copilot Chat 0.55.0 produced no breaking findings, but the one-session probe still reported warning-level missing fields that should not be baseline-accepted without broader probes.
- Keep scanner modules decomposed enough that discovery, evidence, pricing, memory, and parsing can be reasoned about independently.

## Technical Debt

- Scanner behavior is already decomposed but still has follow-up targets for pricing/token normalization and SQLite/state enrichment.
- Customizations inventory and evidence matching need continued clarity between trusted source discovery, classification, and fallback heuristics.
- Scan progress can expose implementation details unless kept behind details UI.
- Large VS Code profiles need careful performance and cancellation behavior.
- Some docs and release notes must stay aligned as extension-first posture evolves.

## Next Recommended Tasks

- Before release-impacting changes, run:
  - `npm run test:scripts`
  - `npm test -- --watch=false`
  - `npm run build`
  - `npm run vscode:package`
- Review Customizations evidence UX against real extension scans.
- Continue scanner decomposition where modules still mix unrelated concerns.
- Smoke test the VSIX on one normal machine and one large/work profile before Marketplace release.

## Open Questions

- After user testing, should Marketplace release use version `0.2.0` or a new bump?
- Should npm publishing remain tied to release tags, or should extension Marketplace publishing become the only public release target?
- Which Customizations preview issues remain after real-machine testing?
