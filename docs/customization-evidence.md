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

The Customizations page keeps scan coverage in a collapsed developer-diagnostics section that lists recorded source locations such as VS Code defaults, VS Code settings, parent-repo defaults, and debug-log references. This is primarily for debugging false negatives on machines with unusual workspace, profile, or monorepo layouts.

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

`Evidence found`

Distinctive content from the customization file was found inside a visible VS Code model request payload or referenced request side file, after the same session showed local evidence that Copilot read or opened that file. Internally this is the strongest evidence state, but the UI avoids phrasing it as absolute proof of all Copilot behavior.

This proves request visibility, not causality. The text may have reached the request because VS Code loaded it as customization context, or because the user explicitly attached/read the file with `#file` or a file-read action.

`Path/reference only`

Local logs show Copilot read, opened, reviewed, or referenced the customization file, but the scanner did not match distinctive file content inside visible model-request material.

`Discovered locally`

VS Code setup/discovery events mentioned the customization, but request payload evidence was not found.

`No local-log evidence`

The file exists locally, but imported sessions did not show discovery or request evidence for it.

## What this proves

The app can say:

- this file exists locally
- VS Code discovered it
- Copilot read, opened, or referenced it in local logs
- distinctive file content appeared in visible request evidence
- which session/request showed that evidence

The app must not say:

- Copilot ignored a customization just because no text match was visible
- the model obeyed the customization
- a text match proves the customization mechanism caused the inclusion
- the customization caused the final answer
- the customization has an exact token cost
- the whole following request should be attributed to that customization

## Staged analysis and cache

The global refresh and customization analysis are deliberately separate:

1. Global refresh performs a lightweight incremental import of changed Copilot sessions and memories.
2. `Analyze customizations` inventories trusted files for the current workspace and checks evidence on demand.
3. A later analysis reuses prior evidence when customization content hashes are unchanged and checks only session logs modified since the previous snapshot.
4. Changing, adding, or removing a customization invalidates the evidence shortcut so the current workspace is analyzed against its available logs again.

The top-right **Global refresh** never starts customization analysis. Both actions use the same serialized local scanner, so while a focused **Customization evidence scan** is running the global action is temporarily unavailable and labeled as such. This keeps routine usage refreshes quick without making the interface look like two scans are running. `Copilot Usage Studio: Full Rescan` remains available from the command palette for recovery when cached state is suspected to be stale.

Results are sorted by distinct text-matched model requests by default. Quick filters separate evidence found, no evidence, partial results, skills, instructions, prompts, and rule-path instructions. The result sidebar is draggable, keyboard-resizable, and remembers one shared width across Customizations and Memory. Generic legacy skill records use metadata, the configured name, or the parent folder as a recognizable display-name fallback.

The default detail view uses one compact evidence sentence and shows the skill or customization description once. File facts, the confidence checklist, paths, and character counts stay collapsed under technical details. Request evidence shows one bounded, highlighted representative excerpt; larger-match metadata is optional. Raw VS Code request-field labels appear only in the separate developer-diagnostics section, where the UI explains that they are fields rather than openable files.

Active analysis uses one compact status line with either percentage or sessions checked. Long-running, stale, stopped, failed, and partial states remain visible without showing competing progress meters and counters.

Evidence matching runs in the scanner worker, not the Angular UI. It supports cancellation and reports session-folder progress through the local runtime. Successful results are merged into the existing local snapshot; a failed or canceled analysis keeps the last valid evidence.

The previous implementation reparsed all session logs on every refresh and rebuilt customization evidence from scratch. That made normal refreshes expensive and blurred two different questions: “is there new Copilot activity?” and “does this workspace's customization evidence need analysis?” The staged workflow makes those boundaries explicit.

## Matching strategy

Strong evidence is normalized exact text matching, not semantic matching.

The scanner uses a conservative evidence chain:

1. Discover trusted customization files from VS Code settings/defaults, conventional documented locations, or exact debug-log references.
2. Look for local debug-log evidence that Copilot read, opened, reviewed, or referenced that file in a session.
3. Only after that session-level read/reference evidence exists, search visible model-request material for distinctive text from the file.

The scanner builds distinctive snippets from customization file content and searches visible VS Code Agent Debug Log request material:

- `inputMessages`
- `userRequest`
- request side files such as `systemPromptFile`
- request side files such as `toolsFile`

Weak evidence is file-read/reference evidence without a distinctive body match. It means local logs made the file visible to Copilot, but the file body was not proven inside the model request.

Very short or generic snippets are ignored for strong proof. A single match must be a substantial block (at least 120 normalized characters and 16 meaningful words), or multiple distinct blocks must cross a larger combined threshold. A common code phrase can appear naturally in repository code or prompts and is never enough by itself.

The evidence scan currently uses VS Code Agent Debug Logs and request side files. It does not treat fallback chat snapshots as strong customization evidence.

False negatives are possible when VS Code logs omit, summarize, transform, truncate, hash, or otherwise avoid storing the full customization body. Large request parts are bounded for performance, so evidence can undercount when VS Code does not expose enough request text.

False positives are possible when customization text is generic or repeated elsewhere. Use distinctive instruction/skill text when you want high-confidence matching.

## Why the distinction matters

VS Code Copilot can resolve or list customizations without necessarily sending the full file body into the model. For example, a request may include an instruction registry entry with file path, description, and `applyTo`, while telling the model to read the full file only when relevant.

That is useful, but it is not the same as proving the content was loaded.

The Customizations page exists to make that distinction visible.
