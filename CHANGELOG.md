# Changelog

All notable changes to Copilot Usage Studio are recorded here.

## Unreleased

- Add a read-only Copilot Memory library for global, repository, workspace, and session-scoped memories and plans.
- Link session-scoped memory files to the imported run that created them.
- Add guarded local-runtime actions to open or reveal an indexed memory file.
- Show source-backed memory recall history from explicit VS Code `memory view` events, linked to the following model request without inventing memory-only cost.
- Compact the Memory page into an IDE-style file browser with filename search, copy-content action, collapsed source view, and scope help.
- Make startup loading a stable page state and clarify that the runtime URL shown during `npm start` is backend-only.
- Add GitHub Actions CI for pull requests, `main`, and pushed feature branches.
- Add tag-driven npm Trusted Publishing with automatic provenance.
- Create the matching GitHub Release from the same version tag.
- Support safe workflow reruns and manual backfill of an existing tagged release.
- Add a VS Code extension preview for Usage, Sessions, Memory, Customizations preview, Compare, Insights, and Prices.
- Build and upload a VSIX artifact from CI for every pushed branch.
- Position the VS Code extension as the primary product path, with Marketplace publication planned after maintainer smoke testing.
- Generate detailed release notes from the changelog and commits for tagged releases.
- Tighten Customizations evidence wording around visible local-log text matches.
- Trust explicit VS Code customization file settings, directories, and globs for file kind while keeping scans bounded by safe file type.
- Add regression coverage for `copilot-instructions.md`, explicit configured customization files, and broad user-profile folders not being scanned by default.
- Compact global scan status so detailed workspace diagnostics stay behind `View details`.
- Report user-stopped scans as stopped while keeping the last valid snapshot visible.
- Make Customizations evidence rows quieter by keeping raw VS Code source fields inside `Proof details` and marking partial evidence as minimum counts.
- Preserve existing Customizations evidence when a normal top-right Refresh runs a quick scan that skips customization indexing.
- Mark Customizations as a preview surface in both docs and the app navigation.
- Purge public roadmap links from README and release-facing docs.
- Refresh GitHub Copilot model pricing from the July 5, 2026 GitHub Docs table, including Claude Sonnet 5, Claude Opus 4.8 fast mode, Kimi K2.7 Code, and updated model statuses.
- Add raw model-id alias support so newly observed VS Code ids can map to the matching GitHub pricing row without hidden fallback pricing.

## 0.2.3 - 2026-07-12

- Ship incremental routine refreshes with a clear up-to-date result and an explicit recovery-oriented full rescan.
- Separate session and memory refresh from on-demand Customizations analysis.
- Cache unchanged customization evidence and inspect only new or changed session logs.
- Require substantial, distinctive text before reporting customization request evidence.
- Preserve conservative discovery, read/reference, and request-text evidence states.
- Improve Customizations actions, empty states, progress reporting, and cancellation behavior.
- Add a VS Code Full Rescan command and automatic lightweight refresh when returning to the app.
- Keep npm, extension, tag, Marketplace, and GitHub Release versions aligned.
- Publish the same tested VSIX automatically through Microsoft Entra workload identity federation.


## 0.2.2 - 2026-07-12
- Make routine refreshes incremental and report clearly when local Copilot data is already up to date.
- Add an explicit full-rescan command for recovery without making every refresh expensive.
- Separate session and memory refresh from on-demand Customizations analysis.
- Cache unchanged customization evidence and analyze only new or changed session logs.
- Require substantial distinctive text before reporting customization request evidence.
- Add conservative read, discovery, and text-match evidence states without claiming causal use.
- Improve Customizations empty states, actions, scan progress, and cancellation behavior.
- Publish one versioned VSIX automatically to the VS Code Marketplace and attach that exact artifact to the matching GitHub Release.
- Enforce matching npm, extension, tag, and release versions in CI.
- Authenticate Marketplace releases through GitHub OIDC and Microsoft Entra workload identity federation without a PAT or client secret.


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
