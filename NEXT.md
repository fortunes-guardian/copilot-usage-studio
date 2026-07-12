# Handoff Notes

Use this file for short-lived current-state context. Keep durable product rules in `AGENTS.md`, engineering rules in `ENGINEERING.md`, and durable decisions in `DECISIONS.md`.

## Current Project Status

- VS Code Marketplace extension is live; Customizations remains a preview feature.
- npm/browser host remains available for development and fallback testing.
- Core app pages exist: Usage, Sessions, Memory, Customizations preview, Compare, Insights, and Prices.
- Scanner imports local VS Code Copilot sessions, debug logs, chat snapshots, memories, plans, and customization evidence.
- Local runtime supports refresh, status, cancellation, logs, cached data, and static app delivery.
- Routine refresh is incremental; full rescan and Customizations analysis are explicit separate operations.
- Release `0.2.2` aligns npm, extension, tag, Marketplace, and GitHub Release versions.
- Tag releases publish the generated VSIX to Marketplace and attach the exact artifact to GitHub.

## Current Priorities

- Validate incremental refresh and Customizations analysis on a large/work profile.
- Configure the `VSCE_PAT` GitHub Actions secret before tagging `v0.2.2`.
- Keep Customizations preview conservative, settings-first, and understandable.
- Preserve schema drift resilience for VS Code Agent Debug Logs.
- Track the latest observed schema audit: VS Code 1.127.0 / Copilot Chat 0.55.0 produced no breaking findings, but the one-session probe still reported warning-level missing fields that should not be baseline-accepted without broader probes.
- Keep scanner modules decomposed enough that discovery, evidence, pricing, memory, and parsing can be reasoned about independently.

## Technical Debt

- Scanner decomposition still has follow-up targets for pricing/token normalization and SQLite/state enrichment.
- Timestamp-based delta scanning cannot observe deleted/restored files reliably; Full Rescan is the recovery path.
- Customizations exact-text evidence can still produce false negatives when VS Code omits or transforms request material.
- Bundle and `app.css` size-budget warnings remain non-blocking technical debt.

## Next Recommended Tasks

- Before release-impacting changes, run:
  - `npm run test:scripts`
  - `npm test -- --watch=false`
  - `npm run build`
  - `npm run vscode:package`
- Push this branch and require green branch CI before merging to `main`.
- Smoke test the CI-built `0.2.2` VSIX on one normal machine and one large/work profile.
- Merge, create tag `v0.2.2`, and let the release workflow publish npm, Marketplace, and GitHub Release artifacts.
- Review Customizations evidence precision against varied real instructions and skills.
- Continue scanner decomposition only where modules still mix unrelated responsibilities.

## Customizations Preview Exit Criteria

- Trusted customization discovery works across user, workspace, and workspace-folder settings.
- Read/discovery evidence and request-text evidence remain visibly distinct.
- A varied corpus demonstrates acceptably low false-positive rates for strong text matches.
- Incremental analysis completes responsively on a large/work profile and cancellation preserves valid cached data.
- Missing or transformed debug-log evidence produces an honest unknown state, not a negative claim.
- At least one stable Marketplace release validates the evidence contract against real VS Code updates.
