# VS Code extension preview

Copilot Usage Studio's VS Code extension is a thin local host for the existing app.

The extension MVP is intentionally smaller than the full browser app:

- Usage
- Memory
- Prices

It does not expose the heavier Sessions, Trace, Compare, Analytics, or Customizations views yet. Customizations should be enabled only after the customization-evidence branch has been merged and tested on real machines.

The extension also disables customization indexing in its scanner options. That is deliberate for the MVP: Usage, Memory, and Prices should open quickly even on machines with many historical workspaces. Customization evidence remains a full-app feature until its source coverage and UX are proven on large real machines.

## Architecture

The extension does not implement a second scanner.

Instead, it:

1. starts the existing local runtime on `127.0.0.1` with a dynamic port;
2. stores generated data under VS Code extension global storage;
3. opens the compiled Angular app in a VS Code webview;
4. injects a tiny host config so the webview calls the extension-started runtime;
5. writes scan/runtime logs to a VS Code Output Channel.

This keeps the npm path and the extension path on the same scanner/runtime code.

For performance, the extension scans only the VS Code user-data root that owns the installed extension. The standalone app may scan both Stable and Insiders roots by default; the extension should not do that because it is already running inside one VS Code installation.

## Commands

- `Copilot Usage Studio: Open`
- `Copilot Usage Studio: Refresh Data`
- `Copilot Usage Studio: Show Logs`
- `Copilot Usage Studio: Open in Browser`

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
6. Confirm Memory and Prices load.
7. Confirm scan progress/errors appear in the `Copilot Usage Studio` Output Channel.
8. Confirm debugger-heavy views are not visible in the extension UI.
9. Confirm startup logs do not include `Indexing customizations` or `Checking customization evidence`.

## Source Requirements

The extension relies on the same local VS Code data as the standalone app.

Exact usage and model-call data comes from VS Code Agent Debug Logs when file logging is enabled. VS Code documents the Agent Debug Log panel as preview, and the setting that writes debug events to disk is:

```text
github.copilot.chat.agentDebugLog.fileLogging.enabled
```

If that setting is off, the extension may still show older cached scans or weaker chat-snapshot data, but it should not promise exact new-session usage. The Output Channel logs the current setting value at startup so support/debugging can quickly tell whether the required local source is enabled.

## Release Posture

First release target is a local VSIX preview attached to the GitHub Release.

The extension is not part of the npm package. The npm package stays focused on `npx copilot-usage-studio`; the VSIX is built from the same source and attached as a separate release asset.

CI runs the normal app release gate and packages a VSIX artifact for pushed branches. Tag releases publish npm as before, then attach the matching VSIX to the GitHub Release with notes generated from `CHANGELOG.md`.

Do not publish to the Marketplace until:

- the local VSIX smoke test has passed on at least one normal machine and one large/work machine;
- startup scans remain responsive;
- extension logs make scan failures diagnosable;
- the extension package contains no local `sessions.json`, prompt data, or schema baselines.
