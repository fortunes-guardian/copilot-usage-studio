import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildSchemaFingerprint, compareSchemaFingerprints } from './audit-vscode-schema.mjs';

const committedBaseline = new URL('../data/vscode-schema-baseline.json', import.meta.url);

test('treats additive fields as informational schema drift', () => {
  const root = fixture('additive', { extraAttr: 'new-value' });
  const baselineRoot = fixture('baseline');
  try {
    const baseline = buildSchemaFingerprint([baselineRoot]);
    const current = buildSchemaFingerprint([root]);
    const diff = compareSchemaFingerprints(current, baseline);
    assert.equal(diff.status, 'compatible');
    assert.equal(diff.issues.some((entry) => entry.code === 'field-added'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(baselineRoot, { recursive: true, force: true });
  }
});

test('fails when a billing-critical model-call field disappears', () => {
  const baselineRoot = fixture('baseline');
  const currentRoot = fixture('missing-model', {}, { omitModel: true });
  try {
    const diff = compareSchemaFingerprints(
      buildSchemaFingerprint([currentRoot]),
      buildSchemaFingerprint([baselineRoot]),
    );
    assert.equal(diff.status, 'breaking');
    assert.equal(diff.issues.some((entry) => entry.message.includes('model')), true);
  } finally {
    rmSync(baselineRoot, { recursive: true, force: true });
    rmSync(currentRoot, { recursive: true, force: true });
  }
});

test('baseline fingerprint excludes prompt and tool payload values', () => {
  const root = fixture('privacy', {}, { prompt: 'PRIVATE PROMPT', toolResult: 'PRIVATE TOOL RESULT' });
  try {
    const serialized = JSON.stringify(buildSchemaFingerprint([root]));
    assert.equal(serialized.includes('PRIVATE PROMPT'), false);
    assert.equal(serialized.includes('PRIVATE TOOL RESULT'), false);
    assert.equal(serialized.includes('content'), true);
    assert.equal(serialized.includes('result'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('committed baseline is structurally valid and contains no local absolute paths', () => {
  const baseline = JSON.parse(readFileSync(committedBaseline, 'utf8'));
  const serialized = JSON.stringify(baseline);
  assert.equal(baseline.fingerprintVersion, 1);
  assert.equal(baseline.llmRequest.count > 0, true);
  assert.equal(serialized.includes('C:\\Users\\'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('AppData'), false);
});

test('warns when an important field becomes intermittent', () => {
  const baselineRoot = fixture('coverage-baseline');
  const currentRoot = fixture('coverage-current', {}, { partialCached: true });
  try {
    const diff = compareSchemaFingerprints(
      buildSchemaFingerprint([currentRoot]),
      buildSchemaFingerprint([baselineRoot]),
    );
    assert.equal(diff.status, 'review');
    assert.equal(diff.issues.some((entry) => entry.code === 'capability-coverage-degraded'), true);
  } finally {
    rmSync(baselineRoot, { recursive: true, force: true });
    rmSync(currentRoot, { recursive: true, force: true });
  }
});

function fixture(name, extraAttrs = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), `copilot-schema-${name}-`));
  mkdirSync(root, { recursive: true });
  const attrs = {
    inputTokens: 100,
    cachedTokens: 80,
    outputTokens: 10,
    copilotUsageNanoAiu: 1000,
    requestOptions: JSON.stringify({ reasoning: { effort: 'medium' } }),
    requestShape: JSON.stringify({ api: 'responses', inputItemTypes: ['function_call_output'] }),
    ...extraAttrs,
  };
  if (!options.omitModel) attrs.model = 'gpt-5-mini';
  const rows = [
    { v: 1, type: 'session_start', name: 'session_start', attrs: { vscodeVersion: '1.0', copilotVersion: '1.0' } },
    { type: 'user_message', name: 'user_message', attrs: { content: options.prompt ?? 'hello' } },
    { type: 'llm_request', name: 'chat:gpt-5-mini', attrs },
    { type: 'tool_call', name: 'read_file', attrs: { result: options.toolResult ?? 'result' } },
  ];
  if (options.partialCached) {
    rows.push({
      type: 'llm_request',
      name: 'chat:gpt-5-mini',
      attrs: { ...attrs, cachedTokens: undefined },
    });
  }
  writeJsonl(join(root, 'main.jsonl'), rows);
  writeFileSync(join(root, 'models.json'), JSON.stringify([{ id: 'gpt-5-mini', capabilities: { limits: { max_prompt_tokens: 1000 } } }]), 'utf8');
  writeFileSync(join(root, 'system_prompt_0.json'), JSON.stringify({ content: JSON.stringify([{ type: 'text', content: 'private instructions' }]) }), 'utf8');
  writeFileSync(join(root, 'tools_0.json'), JSON.stringify({ content: JSON.stringify([{ type: 'function', name: 'read_file', parameters: { type: 'object' } }]) }), 'utf8');
  return root;
}

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}
