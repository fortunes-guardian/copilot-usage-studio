# Copilot customization evidence

Copilot Usage Studio can inspect local Copilot customization files and compare them with imported VS Code Agent Debug Log request evidence.

Status: preview. The feature is useful for debugging AI-assisted development setup, but local logs do not prove every possible way Copilot may use or omit a customization.

The goal is simple:

> Is there local log evidence that this instruction, skill, prompt, hook, agent, or other customization appeared in a model request?

This is not a cost feature first. It is AI-assisted-development observability.

## Sources

The VS Code extension uses VS Code as the source of truth for customization locations.

The extension reads effective VS Code settings/defaults for the open workspace, including:

- `chat.instructionsFilesLocations`
- `chat.promptFilesLocations`
- `chat.agentFilesLocations`
- `chat.agentSkillsLocations`
- `chat.hookFilesLocations`
- `github.copilot.chat.codeGeneration.useInstructionFiles`
- `chat.useAgentsMdFile`
- `chat.useClaudeMdFile`
- `chat.useCustomizationsInParentRepositories`

Those settings can come from user, workspace, workspace-folder, or default VS Code scope. The scanner records that scope so the UI can explain why a location was considered.

The scanner then classifies files inside those trusted locations by the setting kind:

- Markdown files are accepted for instructions, skills, prompts, and agents.
- JSON files are accepted for hooks.
- Explicit configured files are accepted even when the filename does not use a special suffix.

Filename and path conventions such as `.github/copilot-instructions.md`, `.instructions.md`, `SKILL.md`, `.prompt.md`, and `.agent.md` remain fallback behavior for standalone/npm runs, documented defaults, and exact files referenced by debug logs. They must not become broad home-folder or whole-repository crawling in extension mode.

The Customizations page includes a collapsed scan-coverage diagnostic that lists recorded source locations such as VS Code defaults, VS Code settings, parent-repo defaults, and debug-log references. This is primarily for debugging false negatives on machines with unusual workspace, profile, or monorepo layouts.

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

`Text match found`

Distinctive content from the customization file was found inside a visible VS Code model request payload or referenced request side file. Internally this is the strongest evidence state, but the UI avoids phrasing it as absolute proof of all Copilot behavior.

`Name/path only`

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
- distinctive file content appeared in visible request evidence
- which session/request showed that evidence

The app must not say:

- Copilot ignored a customization just because no text match was visible
- the model obeyed the customization
- the customization caused the final answer
- the customization has an exact token cost
- the whole following request should be attributed to that customization

## Matching strategy

Strong evidence is normalized exact text matching, not semantic matching.

The scanner builds distinctive snippets from customization file content and searches visible VS Code Agent Debug Log request material:

- `inputMessages`
- `userRequest`
- request side files such as `systemPromptFile`
- request side files such as `toolsFile`

Weak evidence uses file path, filename, title, description, `applyTo`, and triggers. A weak match means the request named or listed a customization, but the file body was not text-matched.

The evidence scan currently uses VS Code Agent Debug Logs and request side files. It does not treat fallback chat snapshots as strong customization evidence.

False negatives are possible when VS Code logs omit, summarize, transform, truncate, hash, or otherwise avoid storing the full customization body. Large request parts and long scans are also bounded for performance, so partial evidence can undercount.

False positives are possible when customization text is generic or repeated elsewhere. Use distinctive instruction/skill text when you want high-confidence matching.

## Why the distinction matters

VS Code Copilot can resolve or list customizations without necessarily sending the full file body into the model. For example, a request may include an instruction registry entry with file path, description, and `applyTo`, while telling the model to read the full file only when relevant.

That is useful, but it is not the same as proving the content was loaded.

The Customizations page exists to make that distinction visible.
