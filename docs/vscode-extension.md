# VS Code extension preview

Copilot Usage Studio's VS Code extension is a thin local host for the existing app.

The extension MVP is intentionally smaller than the full browser app:

- Usage
- Memory
- Prices

It does not expose the heavier Sessions, Trace, Compare, Analytics, or Customizations views yet. Customizations should be enabled only after the customization-evidence branch has been merged and tested on real machines.

## Architecture

The extension does not implement a second scanner.

Instead, it:

1. starts the existing local runtime on `127.0.0.1` with a dynamic port;
2. stores generated data under VS Code extension global storage;
3. opens the compiled Angular app in a VS Code webview;
4. injects a tiny host config so the webview calls the extension-started runtime;
5. writes scan/runtime logs to a VS Code Output Channel.

This keeps the npm path and the extension path on the same scanner/runtime code.

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

## Release Posture

First release target is a local VSIX preview attached to the GitHub Release.

The extension is not part of the npm package. The npm package stays focused on `npx copilot-usage-studio`; the VSIX is built from the same source and attached as a separate release asset.

CI runs the normal app release gate and also packages a VSIX artifact. Tag releases publish npm as before, then attach the matching VSIX to the GitHub Release.

Do not publish to the Marketplace until:

- the local VSIX smoke test has passed on at least one normal machine and one large/work machine;
- startup scans remain responsive;
- extension logs make scan failures diagnosable;
- the extension package contains no local `sessions.json`, prompt data, or schema baselines.
