# Copilot Usage Studio

Understand your GitHub Copilot usage from inside VS Code.

Copilot Usage Studio helps developers answer questions that are usually hard to answer without access to an enterprise billing console:

- How many Copilot credits did I use today, this week, and this month?
- Which sessions, models, and requests drove that usage?
- What Copilot memories and saved plans exist locally?
- Did my instructions, skills, prompts, hooks, or agents appear in visible Copilot request logs?

It is built for developers who use Copilot heavily and want practical local visibility, not a SaaS dashboard or an official GitHub billing statement.

## What You Get

### Usage Home

See local Copilot usage for:

- Last session
- Today
- This week
- Calendar month
- Selected workspace/model scope

Usage is shown in GitHub AI credits where VS Code exposes source usage, with fallback estimates clearly marked when needed.

### Sessions and Cost

Inspect individual Copilot sessions to understand:

- Input, cached input, cache write, and output token buckets
- Model calls and request shape
- Cost and credit drivers
- Recent usage patterns

### Memory Browser

Browse Copilot memories and saved plans stored locally by VS Code. This is useful when Copilot generated a plan or memory and you want to find it again later.

### Customizations Preview

Preview local evidence for instructions, skills, prompts, hooks, and agents.

This feature is intentionally conservative. It can show when customization text appears in visible VS Code request logs, but it does not claim official billing truth or prove every internal Copilot decision.

## Local First

Copilot Usage Studio runs locally.

- No SaaS backend
- No telemetry
- No upload of prompts, memories, paths, or session data
- Generated cache is stored in VS Code extension storage
- The local runtime binds to `127.0.0.1`

## Commands

- `Copilot Usage Studio: Open`
- `Copilot Usage Studio: Refresh Data`
- `Copilot Usage Studio: Show Logs`
- `Copilot Usage Studio: Export Diagnostics`
- `Copilot Usage Studio: Open in Browser`

## Scope

Supported today:

- VS Code GitHub Copilot Chat and Agent data on the local machine

Not currently supported:

- Visual Studio
- JetBrains IDEs
- Copilot CLI
- GitHub.com chat
- GitHub billing exports

Copilot Usage Studio is an independent open-source developer tool. It is not affiliated with or endorsed by GitHub or Microsoft.
