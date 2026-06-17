# Copilot customization evidence

Copilot Usage Studio can inspect local Copilot customization files and compare them with imported VS Code Agent Debug Log request evidence.

The goal is simple:

> Did this instruction, skill, prompt, hook, or other customization actually reach the model request?

This is not a cost feature first. It is AI-assisted-development observability.

## Sources

The first implementation scans Markdown files under:

```text
<workspace>/.github/instructions/
<workspace>/.github/skills/
<workspace>/.github/prompts/
<workspace>/.github/hooks/
```

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

