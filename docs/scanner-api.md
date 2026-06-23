# Shared Scanner API

The scanner is now reusable Node infrastructure rather than only a command that writes `public/data/sessions.json`.

## Stable Boundary

Import the host API from:

```text
lib/scanner-api.mjs
```

It exposes:

- `scanVsCodeSessions(options)`
- `writeSessionData(sessionData, outputFile)`
- `defaultCodeUserDirs()`

Host code should use this module instead of importing individual parser helpers from `scripts/scan-vscode-sessions.mjs`. Parser functions remain implementation details and can evolve with the observed VS Code schema.

## Scan Without Writing

```js
import { scanVsCodeSessions } from './lib/scanner-api.mjs';

const sessionData = await scanVsCodeSessions();
```

The result is the normalized `SessionData` document consumed by the Angular UI. It contains imported `sessions` plus a sibling `memories` collection for observed Copilot Markdown memories and plans. No file is created or changed.

This is the intended path for:

- a local HTTP runtime
- an `npx` launcher
- an Electron main process
- a VS Code extension host
- tests and schema compatibility checks

## Options

```js
const sessionData = await scanVsCodeSessions({
  roots: ['/custom/Code/User'],
  sqlite: true,
  includeCustomizations: true,
  generatedAt: new Date(),
  onProgress: (event) => console.log(event.message),
});
```

- `roots`: optional array of VS Code `User` directories or individual workspace-storage directories. Defaults to stable VS Code and VS Code Insiders paths for the current operating system.
- `sqlite`: set to `false` to skip optional `state.vscdb` metadata enrichment. Debug-log token and usage import still works.
- `includeCustomizations`: set to `false` to skip instruction/skill/prompt/hook/agent inventory and evidence matching. The VS Code extension normally leaves this enabled because it exposes the Customizations view.
- `includeSystemCustomizations`: set to `true` to include customizations contributed by installed VS Code extensions or VS Code application extension folders. The default is `false` so startup focuses on user/repo customizations and avoids expensive evidence matching for system-provided skills.
- `generatedAt`: optional `Date` or date-compatible value, primarily for deterministic hosts and tests.
- `usdToEur`: legacy generated-contract conversion value. The product UI is USD-first and callers should normally leave this unset.
- `onProgress`: optional callback for host diagnostics. It receives scan-stage events such as root discovery, workspace discovery, debug-log folder counts, memory indexing, and completion. Hosts should treat these as user-facing diagnostics, not stable analytics data.

Duplicate roots are normalized and scanned once. Each call receives fresh ingestion diagnostics; counters and warnings do not leak from earlier scans in a long-running process.

Only one scan may run at a time within one Node process. Hosts should debounce filesystem events and await the current scan instead of starting overlapping work.

## Internal Scanner Modules

The public host boundary remains `lib/scanner-api.mjs`, but the scanner implementation is being decomposed so large-profile performance issues are easier to diagnose.

Current internal split:

- `scripts/scanner-traversal.mjs`: VS Code user-data root discovery, workspace-storage entry discovery, bounded recursive file traversal, dependency/build-folder skips, and root normalization.
- `scripts/scanner-workspace.mjs`: per-storage-entry orchestration for state DB enrichment, customization inventory/evidence, debug-log imports, chat-snapshot imports, memory imports, progress events, and per-entry diagnostics.
- `scripts/scanner-customization-inventory.mjs`: bounded discovery of user, workspace, repo, and configured Copilot customization files without crawling arbitrary repositories.
- `scripts/scanner-customization-evidence.mjs`: request-payload and side-file evidence matching for whether customization text reached model requests.
- `scripts/scanner-memory.mjs`: Copilot memory/plan Markdown import plus memory recall linking from debug-log tool events.
- `scripts/scanner-session-parser.mjs`: Agent Debug Log and chat-snapshot session parsing, token/cache fields, model breakdowns, request payload summaries, trace events, source usage, and fallback chat estimates.
- `scripts/scan-vscode-sessions.mjs`: scan lifecycle, diagnostics lifetime, SQLite enrichment, workspace aggregation, final normalized session-data assembly, CLI argument parsing, and JSON persistence.

Traversal is intentionally separate because broad filesystem walking is the highest-risk performance path. The scanner should scan known VS Code Copilot storage plus targeted Copilot customization/memory roots; it must not crawl arbitrary repositories or home directories.

Next decomposition targets:

- pricing/token normalization
- SQLite/state enrichment helpers

## Local Runtime Host

`lib/local-runtime.mjs` is the first shared API host. It keeps the last valid `SessionData` snapshot in memory, serves it while scans run, and persists successful refreshes.

The local runtime runs the scanner in a child process by default. This keeps the HTTP status/log endpoints responsive while large local VS Code profiles are being imported.

The runtime intentionally keeps scanner and transport concerns separate:

- the scanner knows how to read and normalize VS Code data
- the runtime owns cache lifetime, HTTP status, refresh coordination, and static UI delivery
- the Angular app only consumes normalized session data

This same split can be reused by Electron and a thin VS Code extension without copying parsing or pricing logic.

## Explicit Persistence

```js
import { scanVsCodeSessions, writeSessionData } from './lib/scanner-api.mjs';

const sessionData = await scanVsCodeSessions();
const outputFile = writeSessionData(sessionData, 'public/data/sessions.json');
```

Persistence is separate on purpose. A desktop or extension host can return the in-memory document directly, while the current static Angular workflow can keep using the generated JSON file.

## Existing CLI

The existing command remains compatible:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json <optional-root> [...more-roots]
```

It now performs only three host tasks:

1. parse positional arguments
2. call `scanVsCodeSessions()`
3. call `writeSessionData()` and report the result

There is one parser and pricing implementation. Future hosts should not copy scanner logic.

## Privacy And Source Rules

The API reads local VS Code Copilot storage and can encounter prompts, file paths, repository context, tool schemas, tool results, saved memories, and saved plans. Hosts must keep results local unless a user explicitly exports them.

The API does not change evidence rules:

- source usage is preferred when VS Code logs it
- Agent Debug Log token fields drive token-bucket pricing
- cached input remains separate from normal input and output
- chat snapshots remain fallback data
- SQLite is metadata enrichment, not a billing source
- saved memory files are indexed as local artifacts; their presence does not prove they were recalled into a model request

See [data-ingestion.md](data-ingestion.md), [copilot-memory.md](copilot-memory.md), [debug-log-schema.md](debug-log-schema.md), and [pricing.md](pricing.md) for those contracts.
