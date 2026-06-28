# VS Code extension

Copilot Usage Studio's VS Code extension is the primary product.

The extension exposes the full app inside VS Code:

- Usage
- Sessions
- Memory
- Customizations preview
- Compare
- Insights
- Prices

Selected-run Sessions includes Overview, Cost, Calls, and Trace. Customization evidence is enabled as a preview because the extension keeps the feature close to the editor where instructions, skills, prompts, hooks, and agents are authored. Treat Customizations as local-log evidence, not a guarantee that every Copilot customization use is fully observable.

## Architecture

The extension does not implement a second scanner.

Instead, it:

1. starts the existing local runtime on `127.0.0.1` with a dynamic port;
2. stores generated data under VS Code extension global storage;
3. opens the compiled Angular app in a VS Code webview;
4. injects a tiny host config so the webview calls the extension-started runtime;
5. writes scan/runtime logs to a VS Code Output Channel.

This keeps the extension, scanner, and npm development host on the same runtime code.

For performance, the extension scans only the VS Code user-data root that owns the installed extension. The npm development host may scan both Stable and Insiders roots by default; the extension should not do that because it is already running inside one VS Code installation.

## Commands

- `Copilot Usage Studio: Open`
- `Copilot Usage Studio: Refresh Data`
- `Copilot Usage Studio: Show Logs`
- `Copilot Usage Studio: Export Diagnostics`
- `Copilot Usage Studio: Open in Browser`

`Export Diagnostics` writes a local JSON report into the extension global-storage folder. Use it when a scan appears stuck or a machine behaves differently from local development. The report includes runtime status, bounded scan progress history, per-workspace phase summaries, and recent runtime logs.

## Build And Verify

```bash
npm run vscode:typecheck
npm run vscode:build
npm run vscode:verify
npm run vscode:vsix:dry-run
npm run vscode:package
```

`vscode:build` compiles the Angular app, bundles the extension host, and copies the required runtime files into `vscode-extension/dist`.

`vscode:vsix:dry-run` lists the VSIX package contents with `vsce` without publishing.

`vscode:package` writes a local preview VSIX into `tmp/`.

## Manual Smoke

1. Build the extension with `npm run vscode:package`.
2. Install the local VSIX:
   ```bash
   code --install-extension tmp/copilot-usage-studio-vscode-0.2.0.vsix --force
   ```
3. Run `Copilot Usage Studio: Open`.
4. Confirm Usage loads first.
5. Run `Copilot Usage Studio: Refresh Data`.
6. Confirm Usage, Sessions, Memory, Customizations preview, Compare, Insights, and Prices load.
7. Confirm scan progress/errors appear in the `Copilot Usage Studio` Output Channel.
8. Confirm selected-run Overview, Cost, Calls, and Trace work inside Sessions.
9. Confirm startup logs include customization scan progress and do not hang on large workspaces.

## Source Requirements

The extension relies on local VS Code data.

Exact usage and model-call data comes from VS Code Agent Debug Logs when file logging is enabled. VS Code documents the Agent Debug Log panel as preview, and the setting that writes debug events to disk is:

```text
github.copilot.chat.agentDebugLog.fileLogging.enabled
```

If that setting is off, the extension may still show older cached scans or weaker chat-snapshot data, but it should not promise exact new-session usage. The Output Channel logs the current setting value at startup so support/debugging can quickly tell whether the required local source is enabled.

## Release Posture

Current release target is local VSIX testing first, then VS Code Marketplace publication after maintainer smoke testing.

The extension is not part of the npm package. The VSIX is built from the same source and attached as a separate release asset. The npm package remains useful as a development/runtime fallback, but the extension is the user-facing product path.

CI runs the normal app release gate and packages a VSIX artifact for pushed branches. Tag releases should use curated notes from `CHANGELOG.md`; once Marketplace credentials are configured, the extension publication step should be the primary user-facing release path.

Do not publish to the Marketplace until:

- the local VSIX smoke test has passed on at least one normal machine and one large/work machine;
- startup scans remain responsive;
- extension logs make scan failures diagnosable;
- the extension package contains no local `sessions.json`, prompt data, or schema baselines.
