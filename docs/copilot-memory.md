# Copilot Memory

Copilot Usage Studio indexes locally saved GitHub Copilot memories and plans so a developer can see what Copilot has stored across VS Code workspaces.

## Observed storage

Workspace-scoped files:

```text
<VS Code User>/workspaceStorage/<workspace-id>/GitHub.copilot-chat/memory-tool/memories/
```

Global files:

```text
<VS Code User>/globalStorage/github.copilot-chat/memory-tool/memories/
```

Observed workspace layouts include:

```text
memories/repo/<topic>.md
memories/<base64-session-id>/plan.md
memories/<base64-session-id>/<research>.md
```

The base64 directory decodes to the same session UUID used by Agent Debug Logs and transcripts. This gives the app a source-backed link between a saved plan or research note and the run that created it.

## Normalized record

Each indexed Markdown file records:

- stable local id derived from its absolute path
- `kind`: `memory` or `plan`
- `scope`: `global`, `repository`, `session`, or `workspace`
- title, excerpt, and full Markdown content
- workspace name when applicable
- decoded session id when applicable
- absolute and relative source paths
- created and modified timestamps
- byte, character, and line counts

The scanner reads Markdown files once during the normal local scan. It skips files larger than 1 MiB and caps each memory root at 5,000 files. These limits protect refresh performance without affecting normal observed memory stores, whose files are small.

## Product boundary

Version one is a read-only knowledge library:

- search all saved memory content
- filter by plan/memory, scope, and workspace
- read the Markdown source
- link session-scoped files to imported runs
- open the file or reveal it through the local runtime

The browser does not receive arbitrary filesystem access. Open/reveal actions identify a memory by its scanner-generated id, and the runtime accepts only files present in the current scanned snapshot.

## Observed recall evidence

Agent Debug Logs provide a useful distinction between a memory being available and actually being recalled:

- VS Code injects a memory inventory into model input. The observed inventory names available user, session, and repository memory files, but does not include every file's full contents.
- When the agent calls the `memory` tool with `command: "view"`, the tool event records the requested memory path and returned content.
- That tool result is then present in the following model request. The app can therefore say that a specific memory was loaded before a specific model call.
- The following model call exposes exact total input, cached input, output, and source usage when those fields are present. It does not expose a separate token total or cost for the memory text alone.

In the June 15, 2026 local log sample, 46 JSONL files contained 127 model requests with a memory inventory and 18 explicit memory-tool operations across 11 sessions. Fifteen operations were reads, including repeated reads of the repository memory. These counts establish that recall is observable, but they are only a local sample and not a VS Code API contract.

A future recall view can reliably show:

- which memory path was read
- when and in which session it was read
- the returned content size
- the next model call and that call's total token/usage facts

It must not label the entire following request as memory cost or derive an exact memory-only token charge from character count.

## What the app does not claim

A saved memory is evidence that Copilot wrote a local file. A matching `memory view` tool event is evidence that Copilot later recalled it and included the returned content in the request chain.

Therefore the first version does not label memories as useful, stale, harmful, or token-consuming. Those conclusions require a matching Agent Debug Log or request side-file showing that the memory was included in a model request.

Future evidence-backed opportunities:

- mark when a specific memory is observed in a `memory view` event
- show memory recall frequency and last observed use
- link each recall to the following model call without claiming exact memory-only cost
- flag conflicting or old memories for review
- compare request input before and after a memory is edited or removed
- help turn a proven durable memory into repository instructions
- map repository memories to code/domain areas when paths or content provide a reliable relationship

Editing and deletion remain later work. The files are technically accessible, but VS Code's indexing and lifecycle contract is not documented strongly enough to make destructive management a first-release feature.
