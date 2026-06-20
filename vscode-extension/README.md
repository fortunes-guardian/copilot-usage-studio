# Copilot Usage Studio

Local GitHub Copilot usage and memory insights for VS Code.

This extension is a local preview host for Copilot Usage Studio. It opens the existing app inside VS Code and focuses on the most useful day-to-day views:

- Usage
- Memory
- Prices

The extension starts a local runtime on `127.0.0.1`, scans local VS Code Copilot data, and stores its generated cache in VS Code extension storage. No SaaS backend is used.

## Commands

- `Copilot Usage Studio: Open`
- `Copilot Usage Studio: Refresh Data`
- `Copilot Usage Studio: Show Logs`
- `Copilot Usage Studio: Open in Browser`

## Status

Early local VSIX preview. Test locally before relying on it for daily use.

The full browser app remains available with:

```bash
npx copilot-usage-studio
```
