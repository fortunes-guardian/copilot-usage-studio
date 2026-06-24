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
        readJsonl: (sessionFile) => [
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
    assert.equal(customization.matches.length, 2);
    assert.ok(diagnostics.warnings.some((warning) => warning.includes('limited to 2 model calls')));
    assert.ok(progress.some((event) => event.capped === true));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
