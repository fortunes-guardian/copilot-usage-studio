# Product Intent

Build a local developer cost debugger for VS Code GitHub Copilot sessions.

The app should make a complicated topic easy to inspect:

- What did this agent/chat session cost?
- Which model was used?
- Which token category drove the cost?
- Which individual model calls were expensive?
- Which GitHub price rows were used?
- Did one run cost more or less than another run?

## Product Angle

VS Code already has session/debug information. Our angle is:

- add cost estimates
- explain the cost in plain language
- expose the GitHub prices used by the calculation
- make source quality obvious
- support later comparison between runs

## Principles

- **One run excellent first.** A selected session should be easy to understand before comparison becomes deep.
- **Transparency over magic.** Show where data came from and what it means.
- **Local-first.** Read local VS Code data and generate an app-owned JSON contract.
- **Debug logs are preferred.** They are the strongest local source for model ids and token counts.
- **SQLite is enrichment.** VS Code `state.vscdb` improves names and metadata, but does not drive pricing.
- **Billing reconciliation is later.** The app is currently a local estimate/debugger, not a GitHub invoice clone.
- **Use human language.** Avoid raw internal strings in the UI where a clear label can work.

## Near-Term Direction

Keep improving the selected-run Cost debugger:

- size and warning labels
- clearer session-list scanning
- better comparison only after single-run diagnosis feels strong
- later visual/style rework

