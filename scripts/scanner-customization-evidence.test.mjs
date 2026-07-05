import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { customizationEvidenceFromDebugLogs } from './scanner-customization-evidence.mjs';

test('customization evidence scan stops at the configured model-call budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-customization-evidence-'));
  const debugRoot = join(root, 'debug-logs');
  const sessionDirs = Array.from({ length: 5 }, (_, index) => join(debugRoot, `session-${index + 1}`));
  const diagnostics = {
    customizationEvidenceScannedSessions: 0,
    customizationEvidenceModelCalls: 0,
    customizationEvidenceTextParts: 0,
    customizationEvidenceMatchedCustomizations: 0,
    warnings: [],
  };
  const progress = [];

  try {
    mkdirSync(debugRoot, { recursive: true });
    for (const sessionDir of sessionDirs) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const [customization] = customizationEvidenceFromDebugLogs(
      debugRoot,
      [
        {
          id: 'instruction-1',
          kind: 'instruction',
          title: 'Backend rules',
          name: 'backend.instructions.md',
          description: 'Always create aggregates with validators.',
          applyTo: [],
          triggers: [],
          scope: 'workspace',
          workspace: 'fixture',
          sourcePath: join(root, 'backend.instructions.md'),
          relativePath: 'backend.instructions.md',
          createdAt: '2026-06-24T10:00:00.000Z',
          modifiedAt: '2026-06-24T10:00:00.000Z',
          sizeBytes: 128,
          characterCount: 128,
          lineCount: 3,
          excerpt: 'Always create aggregates with validators.',
          evidenceStatus: 'not_seen',
          matches: [],
          _content:
            'Always create aggregates with validators before saving domain state. Use explicit invariants and never bypass validation.',
        },
      ],
      'fixture',
      root,
      (event) => progress.push(event),
      {
        diagnostics,
        listDirs: () => sessionDirs,
        readJsonl: () => [
          {
            timestamp: '2026-06-24T10:00:30.000Z',
            type: 'tool_call',
            name: 'read_file',
            attrs: {
              details: `Read ${join(root, 'backend.instructions.md')}`,
            },
          },
          {
            timestamp: '2026-06-24T10:01:00.000Z',
            type: 'llm_request',
            name: 'panel/editAgent',
            attrs: {
              inputMessages:
                'Always create aggregates with validators before saving domain state. Use explicit invariants and never bypass validation.',
            },
          },
        ],
        maxModelCalls: 2,
      },
    );

    assert.equal(diagnostics.customizationEvidenceModelCalls, 2);
    assert.equal(customization.evidenceStatus, 'sent');
    assert.equal(customization.matches.filter((match) => match.status === 'sent').length, 2);
    assert.equal(customization.matches.filter((match) => match.source === 'copilotFileRead').length, 2);
    assert.ok(diagnostics.warnings.some((warning) => warning.includes('limited to 2 model calls')));
    assert.ok(progress.some((event) => event.capped === true));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('customization content is not promoted without prior file-read evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-customization-no-read-'));
  const debugRoot = join(root, 'debug-logs');
  const sessionDir = join(debugRoot, 'session-1');

  try {
    mkdirSync(sessionDir, { recursive: true });
    const [customization] = customizationEvidenceFromDebugLogs(
      debugRoot,
      [
        {
          id: 'instruction-1',
          kind: 'instruction',
          title: 'Backend rules',
          name: 'backend.instructions.md',
          description: 'Always create aggregates with validators.',
          applyTo: [],
          triggers: [],
          scope: 'workspace',
          workspace: 'fixture',
          sourcePath: join(root, 'backend.instructions.md'),
          relativePath: 'backend.instructions.md',
          createdAt: '2026-06-24T10:00:00.000Z',
          modifiedAt: '2026-06-24T10:00:00.000Z',
          sizeBytes: 128,
          characterCount: 128,
          lineCount: 3,
          excerpt: 'Always create aggregates with validators.',
          evidenceStatus: 'not_seen',
          matches: [],
          _content:
            'Always create aggregates with validators before saving domain state. Use explicit invariants and never bypass validation.',
        },
      ],
      'fixture',
      root,
      () => {},
      {
        listDirs: () => [sessionDir],
        readJsonl: () => [
          {
            timestamp: '2026-06-24T10:01:00.000Z',
            type: 'llm_request',
            name: 'panel/editAgent',
            attrs: {
              inputMessages:
                'Always create aggregates with validators before saving domain state. Use explicit invariants and never bypass validation.',
            },
          },
        ],
      },
    );

    assert.equal(customization.evidenceStatus, 'not_seen');
    assert.equal(customization.matches.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('file-read evidence is recorded without claiming model-request text proof', () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-customization-read-only-'));
  const debugRoot = join(root, 'debug-logs');
  const sessionDir = join(debugRoot, 'session-1');

  try {
    mkdirSync(sessionDir, { recursive: true });
    const [customization] = customizationEvidenceFromDebugLogs(
      debugRoot,
      [
        {
          id: 'instruction-1',
          kind: 'instruction',
          title: 'Backend rules',
          name: 'backend.instructions.md',
          description: 'Always create aggregates with validators.',
          applyTo: [],
          triggers: [],
          scope: 'workspace',
          workspace: 'fixture',
          sourcePath: join(root, 'backend.instructions.md'),
          relativePath: 'backend.instructions.md',
          createdAt: '2026-06-24T10:00:00.000Z',
          modifiedAt: '2026-06-24T10:00:00.000Z',
          sizeBytes: 128,
          characterCount: 128,
          lineCount: 3,
          excerpt: 'Always create aggregates with validators.',
          evidenceStatus: 'not_seen',
          matches: [],
          _content:
            'Always create aggregates with validators before saving domain state. Use explicit invariants and never bypass validation.',
        },
      ],
      'fixture',
      root,
      () => {},
      {
        listDirs: () => [sessionDir],
        readJsonl: () => [
          {
            timestamp: '2026-06-24T10:00:30.000Z',
            type: 'tool_call',
            name: 'read_file',
            attrs: {
              details: `Read ${join(root, 'backend.instructions.md')}`,
            },
          },
          {
            timestamp: '2026-06-24T10:01:00.000Z',
            type: 'llm_request',
            name: 'panel/editAgent',
            attrs: {
              inputMessages: 'This prompt mentions backend.instructions.md but does not include the instruction body.',
            },
          },
        ],
      },
    );

    assert.equal(customization.evidenceStatus, 'listed');
    assert.equal(customization.matches.length, 1);
    assert.equal(customization.matches[0].source, 'copilotFileRead');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generic short customization snippets are not treated as strong proof', () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-customization-generic-'));
  const debugRoot = join(root, 'debug-logs');
  const sessionDir = join(debugRoot, 'session-1');

  try {
    mkdirSync(sessionDir, { recursive: true });
    const [customization] = customizationEvidenceFromDebugLogs(
      debugRoot,
      [
        {
          id: 'instruction-1',
          kind: 'instruction',
          title: 'Cancellation rules',
          name: 'cancellation.instructions.md',
          description: 'Cancellation token rule.',
          applyTo: [],
          triggers: [],
          scope: 'workspace',
          workspace: 'fixture',
          sourcePath: join(root, 'cancellation.instructions.md'),
          relativePath: 'cancellation.instructions.md',
          createdAt: '2026-06-24T10:00:00.000Z',
          modifiedAt: '2026-06-24T10:00:00.000Z',
          sizeBytes: 64,
          characterCount: 64,
          lineCount: 1,
          excerpt: 'Always pass CancellationToken.',
          evidenceStatus: 'not_seen',
          matches: [],
          _content: 'Always pass CancellationToken() to every async method.',
        },
      ],
      'fixture',
      root,
      () => {},
      {
        listDirs: () => [sessionDir],
        readJsonl: () => [
          {
            timestamp: '2026-06-24T10:00:30.000Z',
            type: 'tool_call',
            name: 'read_file',
            attrs: {
              details: `Read ${join(root, 'cancellation.instructions.md')}`,
            },
          },
          {
            timestamp: '2026-06-24T10:01:00.000Z',
            type: 'llm_request',
            name: 'panel/editAgent',
            attrs: {
              inputMessages: 'Always pass CancellationToken() to every async method.',
            },
          },
        ],
      },
    );

    assert.equal(customization.evidenceStatus, 'listed');
    assert.equal(customization.matches.length, 1);
    assert.equal(customization.matches[0].source, 'copilotFileRead');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
