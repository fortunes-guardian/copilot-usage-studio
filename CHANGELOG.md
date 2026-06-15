# Changelog

All notable changes to Copilot Usage Studio are recorded here.

## Unreleased

- Add a read-only Copilot Memory library for global, repository, workspace, and session-scoped memories and plans.
- Link session-scoped memory files to the imported run that created them.
- Add guarded local-runtime actions to open or reveal an indexed memory file.
- Show source-backed memory recall history from explicit VS Code `memory view` events, linked to the following model request without inventing memory-only cost.
- Add GitHub Actions CI for pull requests and pushes to `main`.
- Add tag-driven npm Trusted Publishing with automatic provenance.
- Create the matching GitHub Release from the same version tag.
- Support safe workflow reruns and manual backfill of an existing tagged release.

## 0.1.0 - 2026-06-14

Initial local developer preview.

- Scan local VS Code GitHub Copilot Chat and Agent debug logs.
- Prefer source-reported usage and preserve explicit fallback pricing.
- Separate normal input, cached input, cache write, and output token buckets.
- Explore usage by session, day, week, calendar month, model, and workspace.
- Inspect calls, context load, setup footprint, and raw trace evidence.
- Compare selected runs and review the GitHub pricing rows used by the app.
- Run the complete local application with `npx copilot-usage-studio`.
- Keep imported session data on the developer's machine.
- Use the GitHub Copilot model rate card checked on June 14, 2026.
- Apply GPT-5.4, GPT-5.5, and Gemini 3.1 Pro long-context rates per model call rather than to aggregated session tokens.
- Preserve the selected pricing tier and per-bucket model costs in generated session data.

Copilot Usage Studio is an independent open-source developer tool and is not affiliated with or endorsed by GitHub or Microsoft.
