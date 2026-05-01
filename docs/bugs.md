# Bugs And UX Notes

This file is for short-lived issues found while using the app. Fixed items are summarized so the reason is not lost.

## Fixed

- Cache wording no longer implies cache tokens were imported when VS Code local logs do not expose cache read/write fields.
- Session summary now sits above the Cost debugger and no longer repeats cost/token sections already handled by the debugger.
- Agent flow chart uses visible flow-step numbering instead of raw event indexes, so filtered setup events do not make a session start at `#13`.
- Agent flow chart and largest-call views show token/cost detail from structured trace-event fields.
- User messages in the log now stand out visually and get a `User` badge.
- Long sessions now keep up to `1000` trace events in the generated ledger, so compacted or later activity is visible in the UI.
- Header source chips use human labels like `Exact local data` and `Debug-log token counts` instead of raw internal strings.
- Data ingest summary is more compact.
- Cache visibility now appears under `Estimate scope`, so it reads as a limitation note rather than the answer to “why this run cost X”.

## Open

- Consider whether the product name should stay `Copilot Cost Ledger` or move toward `Copilot Cost Debugger`.
- Major style rework: visual hierarchy, spacing, responsive tables, and a calmer debugger-like polish.
- Frontend code cleanup once the feature shape settles.
- More focused frontend tests after the main flows are stable.

