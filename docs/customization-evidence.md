# Copilot customization evidence

Copilot Usage Studio can inspect local Copilot customization files and compare them with imported VS Code Agent Debug Log request evidence.

The goal is simple:

> Did this instruction, skill, prompt, hook, agent, or other customization actually reach the model request?

This is not a cost feature first. It is AI-assisted-development observability.

## Sources

The scanner only looks in bounded Copilot customization locations for workspaces that have imported VS Code Copilot data. It does not crawl the whole repository.

It checks:

```text
<workspace-or-parent-repo>/.github/copilot-instructions.md
<workspace-or-parent-repo>/.github/instructions/**/*.md
<workspace-or-parent-repo>/.claude/rules/**/*.md
<workspace-or-parent-repo>/.copilot/instructions/**/*.md
<workspace-or-parent-repo>/.github/skills/**/*.md
<workspace-or-parent-repo>/.claude/skills/**/SKILL.md
<workspace-or-parent-repo>/.agents/skills/**/SKILL.md
<workspace-or-parent-repo>/.copilot/skills/**/SKILL.md
<workspace-or-parent-repo>/.github/prompts/**/*.md
<workspace-or-parent-repo>/.copilot/prompts/**/*.md
<workspace-or-parent-repo>/.github/hooks/**/*.json
<workspace-or-parent-repo>/.copilot/hooks/**/*.json
<workspace-or-parent-repo>/.github/agents/**/*.md
<workspace-or-parent-repo>/.claude/agents/**/*.md
<workspace-or-parent-repo>/.copilot/agents/**/*.md
<workspace-or-parent-repo>/AGENTS.md
<workspace-or-parent-repo>/CLAUDE.md
<workspace-or-parent-repo>/.claude/CLAUDE.md
<workspace-or-parent-repo>/GEMINI.md
<VS Code User>/prompts/**/*.md
~/.copilot/skills/**/*.md
~/.claude/skills/**/*.md
```

For monorepos, the app walks from the opened workspace folder up to the nearest Git repository root and checks those known locations at each level. It also reads workspace/user VS Code settings such as `chat.instructionsFilesLocations`, `chat.promptFilesLocations`, `chat.agentFilesLocations`, `chat.agentSkillsLocations`, and `chat.hookFilesLocations` when those settings files are available locally. Finally, it imports exact customization files referenced by VS Code debug-log side files and exact customization folders listed by VS Code discovery events. This matters for user-profile skills, agents, and prompts because VS Code can use folders outside the repository.

The scanner also checks bounded user-default roots that VS Code documents or commonly uses for personal skills/hooks:

```text
~/.copilot/skills/**/SKILL.md
~/.claude/skills/**/SKILL.md
~/.agents/skills/**/SKILL.md
~/.copilot/hooks/**/*.json
~/.claude/settings.json
~/.claude/settings.local.json
```

The Customizations page includes a collapsed scan-coverage diagnostic that lists the recorded roots, direct files, VS Code setting roots, debug-referenced files, and debug-discovery folders checked during ingestion. This is primarily for debugging false negatives on machines with unusual workspace, profile, or monorepo layouts.

The VS Code extension runs this indexing because it is the primary product surface and can read effective VS Code settings. If a machine appears slow or stuck, use `Copilot Usage Studio: Show Logs` or `Copilot Usage Studio: Export Diagnostics` to inspect the current workspace phase and customization-evidence progress.

The scanner stores metadata only in generated app data:

- kind
- title/name
- description
- `applyTo`
- triggers
- path
- size
- excerpt
- evidence matches

It reads full file content during the scan to build fingerprints, but it does not persist the full customization body into `sessions.json`.

## Evidence states

`Sent to model`

Distinctive content from the customization file was found inside a model request payload or referenced request side file.

`Listed only`

The request listed the customization by filename, path, title, description, trigger, or `applyTo`, but the scanner did not match full content.

`Discovered only`

VS Code setup/discovery events mentioned the customization, but request payload evidence was not found.

`Not seen`

The file exists locally, but imported sessions did not show discovery or request evidence for it.

## What this proves

The app can say:

- this file exists locally
- VS Code discovered it
- the model request listed it
- distinctive file content appeared in request evidence
- which session/request showed that evidence

The app must not say:

- the model obeyed the customization
- the customization caused the final answer
- the customization has an exact token cost
- the whole following request should be attributed to that customization

## Why the distinction matters

VS Code Copilot can resolve or list customizations without necessarily sending the full file body into the model. For example, a request may include an instruction registry entry with file path, description, and `applyTo`, while telling the model to read the full file only when relevant.

That is useful, but it is not the same as proving the content was loaded.

The Customizations page exists to make that distinction visible.
