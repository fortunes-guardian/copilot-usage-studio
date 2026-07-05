import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  attachMemoryRecalls,
  cacheTokenAuditFromLlmRequests,
  eventModelCostFields,
  llmTokenFields,
  mergeCacheTokenAudits,
  memoryRecallsFromDebugLog,
  modelBreakdownFromLlmRequests,
  runScannerCli,
  scanVsCodeSessions,
  sessionFromChatSnapshot,
  sessionFromDebugLog,
} from './scan-vscode-sessions.mjs';

test('records explicit memory reads and links them to the following model request', () => {
  const { root, sessionDir } = tempSessionFixture('memory-recall-session');
  const subagentFile = join(sessionDir, 'runSubagent-Explore-call_1.jsonl');

  try {
    writeJsonl(subagentFile, [
      event(1, 'tool_call', 'memory', {
        attrs: {
          args: JSON.stringify({ command: 'view', path: '/memories/repo/architecture.md' }),
          result: '# Architecture\n\nUse the shared scanner API.',
        },
      }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 12_000,
          cachedTokens: 10_000,
          outputTokens: 250,
        },
      }),
    ]);

    const recalls = memoryRecallsFromDebugLog(sessionDir, 'example-workspace');

    assert.equal(recalls.length, 1);
    assert.equal(recalls[0].virtualPath, '/memories/repo/architecture.md');
    assert.equal(recalls[0].workspace, 'example-workspace');
    assert.equal(recalls[0].returnedCharacterCount, 43);
    assert.deepEqual(recalls[0].followingModelCall, {
      number: 1,
      model: 'GPT-5.4',
      inputTokens: 12_000,
      cachedInputTokens: 10_000,
      outputTokens: 250,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('attaches recalls only to the matching memory scope and workspace', () => {
  const memories = [
    {
      id: 'repo-a',
      scope: 'repository',
      workspace: 'repo-a',
      sessionId: '',
      relativePath: 'repo\\architecture.md',
    },
    {
      id: 'repo-b',
      scope: 'repository',
      workspace: 'repo-b',
      sessionId: '',
      relativePath: 'repo\\architecture.md',
    },
  ];
  const recall = {
    id: 'recall-1',
    sessionId: 'session-1',
    workspace: 'repo-a',
    virtualPath: '/memories/repo/architecture.md',
    timestamp: '2026-06-15T10:00:00.000Z',
    sourceLog: 'main.jsonl',
    returnedCharacterCount: 100,
  };

  const attached = attachMemoryRecalls(memories, [{ memoryRecalls: [recall] }]);

  assert.deepEqual(attached[0].recalls, [recall]);
  assert.equal(attached[1].recalls, undefined);
});

test('splits raw VS Code inputTokens into normal and cached input tokens', () => {
  const tokenFields = llmTokenFields({
    attrs: {
      inputTokens: 23_911,
      cachedTokens: 21_632,
      outputTokens: 285,
    },
  });

  assert.equal(tokenFields.inputTokens, 23_911);
  assert.equal(tokenFields.billableInputTokens, 2_279);
  assert.equal(tokenFields.cachedInputTokens, 21_632);
  assert.equal(tokenFields.outputTokens, 285);
});

test('clamps impossible cachedTokens while preserving the invalid split audit', () => {
  const event = {
    attrs: {
      inputTokens: 100,
      cachedTokens: 125,
      outputTokens: 10,
    },
  };

  assert.equal(llmTokenFields(event).cachedInputTokens, 100);

  const audit = cacheTokenAuditFromLlmRequests([event]);
  assert.equal(audit.modelCalls, 1);
  assert.equal(audit.callsWithCachedTokens, 1);
  assert.equal(audit.invalidCachedTokenSplits, 1);
  assert.equal(audit.rawInputTokens, 100);
  assert.equal(audit.normalInputTokens, 0);
  assert.equal(audit.cachedInputTokens, 100);
  assert.equal(audit.outputTokens, 10);
});

test('prices scanner model fields from the four priced buckets', () => {
  const tokenFields = llmTokenFields({
    attrs: {
      inputTokens: 6_000_000,
      cachedTokens: 2_000_000,
      cacheWriteTokens: 3_000_000,
      outputTokens: 4_000_000,
    },
  });

  const modelCost = eventModelCostFields('claude-sonnet-4.6', tokenFields);

  assert.equal(modelCost.model, 'Claude Sonnet 4.6');
  assert.equal(modelCost.pricingModel, 'Claude Sonnet 4.6');
  assert.equal(modelCost.totalTokens, 13_000_000);
  assert.equal(modelCost.estimatedCost.usd, 83.85);
});

test('records the request pricing tier and does not tier aggregated session tokens', () => {
  const longContextFields = llmTokenFields({
    attrs: { inputTokens: 300_000, cachedTokens: 100_000, outputTokens: 1_000 },
  });
  const longContextCost = eventModelCostFields('gpt-5.4', longContextFields);

  assert.equal(longContextCost.pricingTier, 'Long context');
  assert.equal(longContextCost.estimatedCost.usd, 1.0725);

  const breakdown = modelBreakdownFromLlmRequests([
    { attrs: { model: 'gpt-5.4', inputTokens: 200_000, outputTokens: 0 } },
    { attrs: { model: 'gpt-5.4', inputTokens: 200_000, outputTokens: 0 } },
  ])[0];

  assert.deepEqual(breakdown.pricingTiers, ['Default']);
  assert.equal(breakdown.cost.usd, 1);
  assert.equal(breakdown.costBreakdown.inputUsd, 1);
});

test('merges cache token audits without losing max cached share', () => {
  const merged = mergeCacheTokenAudits([
    {
      modelCalls: 1,
      callsWithCachedTokens: 1,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 100,
      normalInputTokens: 75,
      cachedInputTokens: 25,
      cacheWriteTokens: 0,
      outputTokens: 10,
      maxCachedInputShare: 0.25,
    },
    {
      modelCalls: 1,
      callsWithCachedTokens: 1,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 100,
      normalInputTokens: 10,
      cachedInputTokens: 90,
      cacheWriteTokens: 3,
      outputTokens: 20,
      maxCachedInputShare: 0.9,
    },
  ]);

  assert.equal(merged.modelCalls, 2);
  assert.equal(merged.callsWithCachedTokens, 2);
  assert.equal(merged.rawInputTokens, 200);
  assert.equal(merged.normalInputTokens, 85);
  assert.equal(merged.cachedInputTokens, 115);
  assert.equal(merged.cacheWriteTokens, 3);
  assert.equal(merged.outputTokens, 30);
  assert.equal(merged.maxCachedInputShare, 0.9);
});

test('imports exact debug-log token totals from a session fixture', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('exact-debug-log');
  try {
    writeFileSync(
      join(sessionDir, 'system_prompt_0.json'),
      JSON.stringify({
        content: JSON.stringify([{ role: 'system', content: 'Follow repo instructions.' }]),
      }),
      'utf8',
    );
    writeFileSync(
      join(sessionDir, 'tools_0.json'),
      JSON.stringify({
        content: JSON.stringify([
          {
            function: {
              name: 'mcp_files_read',
              description: 'Read a file from the workspace.',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
          {
            function: {
              name: 'local_list_dir',
              description: 'List a directory.',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
        ]),
      }),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'session_start', 'session_start'),
      event(2, 'user_message', 'user message', {
        attrs: { content: 'Review the latest branch changes.' },
      }),
      event(3, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 23_911,
          cachedTokens: 21_632,
          outputTokens: 285,
          copilotUsageNanoAiu: 1_538_050_000,
          estimatedCost: { currency: 'USD', total: 0.02 },
          ttft: 398,
          requestOptions: JSON.stringify({ reasoning: { effort: 'high' } }),
          systemPromptFile: 'system_prompt_0.json',
          toolsFile: 'tools_0.json',
        },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);

    assert.equal(session.tokenSource, 'llm_request_token_totals');
    assert.equal(session.confidence, 'exact');
    assert.deepEqual(session.tokens, {
      input: 2_279,
      cachedInput: 21_632,
      cacheWrite: 0,
      output: 285,
    });
    assert.equal(session.traceSummary.totalTokens, 24_196);
    assert.equal(session.cacheTokenAudit.rawInputTokens, 23_911);
    assert.equal(session.cacheTokenAudit.normalInputTokens, 2_279);
    assert.equal(session.cacheTokenAudit.cachedInputTokens, 21_632);
    assert.equal(session.traceEvents[2].inputTokens, 23_911);
    assert.equal(session.traceEvents[2].cachedInputTokens, 21_632);
    assert.equal(session.traceEvents[2].reasoningEffort, 'high');
    assert.equal(session.traceEvents[2].sourceEstimatedCost, '{"currency":"USD","total":"0.02"}');
    assert.deepEqual(session.traceEvents[2].sourceUsage, {
      nanoAiu: 1_538_050_000,
      credits: 1.53805,
      usd: 0.0153805,
      modelCalls: 1,
    });
    assert.deepEqual(session.sourceUsage, {
      nanoAiu: 1_538_050_000,
      credits: 1.53805,
      usd: 0.0153805,
      modelCalls: 1,
    });
    assert.equal(session.traceEvents[2].setupPayload.systemPromptFile, 'system_prompt_0.json');
    assert.equal(session.traceEvents[2].setupPayload.systemPromptChars > 0, true);
    assert.equal(session.traceEvents[2].setupPayload.toolsFile, 'tools_0.json');
    assert.equal(session.traceEvents[2].setupPayload.toolCount, 2);
    assert.equal(session.traceEvents[2].setupPayload.mcpToolCount, 1);
    assert.deepEqual(session.traceEvents[2].setupPayload.mcpToolNames, ['mcp_files_read']);
    assert.deepEqual(session.transcript, {
      available: false,
      sourcePath: '',
      eventCount: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves current VS Code Copilot runtime and request-shape metadata', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('runtime-and-request-shape');
  try {
    writeFileSync(
      join(sessionDir, 'models.json'),
      JSON.stringify([
        {
          id: 'gpt-5-mini',
          name: 'GPT-5 mini',
          version: 'gpt-5-mini',
          vendor: 'Azure OpenAI',
          model_picker_enabled: true,
          is_chat_default: true,
          is_chat_fallback: false,
          supported_endpoints: ['/chat/completions', '/responses', 'ws:/responses'],
          capabilities: {
            tokenizer: 'o200k_base',
            limits: {
              max_context_window_tokens: 264_000,
              max_prompt_tokens: 127_997,
              max_output_tokens: 64_000,
            },
            supports: {
              reasoning_effort: ['low', 'medium', 'high'],
            },
          },
        },
      ]),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'session_start', 'session_start', {
        v: 1,
        attrs: { vscodeVersion: '1.122.1', copilotVersion: '0.50.1' },
      }),
      event(2, 'user_message', 'user message', { attrs: { content: 'Test' } }),
      event(3, 'llm_request', 'chat:gpt-5-mini', {
        attrs: {
          model: 'gpt-5-mini',
          inputTokens: 22_421,
          cachedTokens: 5_632,
          outputTokens: 308,
          requestOptions: JSON.stringify({
            reasoning: { effort: 'medium', summary: 'detailed' },
            text: { verbosity: 'low' },
          }),
          requestShape: JSON.stringify({
            api: 'responses',
            inputItemCount: 1,
            inputItemTypes: ['function_call_output'],
            hasPreviousResponseId: true,
          }),
        },
      }),
      event(4, 'generic', 'Resolve Customizations', {
        attrs: {
          category: 'customization',
          source: 'core',
          details: 'Resolved 1 customizations (1 listed) in 356.6ms',
        },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);
    const modelEvent = session.traceEvents[2];

    assert.deepEqual(session.debugLogRuntime, {
      logVersion: 1,
      vscodeVersion: '1.122.1',
      copilotVersion: '0.50.1',
    });
    assert.equal(session.model, 'GPT-5 mini');
    assert.equal(session.modelLimits[0].promptLimitTokens, 127_997);
    assert.equal(session.modelLimits[0].contextWindowTokens, 264_000);
    assert.equal(session.modelLimits[0].largestRawInputTokens, 22_421);
    assert.equal(session.modelLimits[0].totalRawInputTokens, 22_421);
    assert.equal(session.modelLimits[0].supportedEndpoints.includes('/responses'), true);
    assert.deepEqual(session.modelLimits[0].supportedReasoningEfforts, ['low', 'medium', 'high']);
    assert.equal(modelEvent.reasoningEffort, 'medium');
    assert.deepEqual(modelEvent.requestShape, {
      api: 'responses',
      inputItemCount: 1,
      inputItemTypes: ['function_call_output'],
      hasPreviousResponseId: true,
    });
    assert.deepEqual(
      modelEvent.attributes.filter((field) =>
        ['textVerbosity', 'requestShape'].includes(field.label),
      ),
      [
        { label: 'textVerbosity', value: 'low' },
        {
          label: 'requestShape',
          value:
            'api: responses · 1 input item · types: function_call_output · continues previous response',
        },
      ],
    );
    assert.deepEqual(
      session.traceEvents[3].attributes.filter((field) =>
        ['category', 'source'].includes(field.label),
      ),
      [
        { label: 'category', value: 'customization' },
        { label: 'source', value: 'core' },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores debug-log side files outside the session folder', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('side-file-boundary');
  try {
    writeFileSync(join(root, 'outside.json'), JSON.stringify({ content: 'must not read' }), 'utf8');
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Check side file safety.' } }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 100,
          outputTokens: 10,
          systemPromptFile: '..\\outside.json',
        },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);

    assert.equal(session.traceEvents[1].setupPayload.systemPromptFile, '..\\outside.json');
    assert.equal(session.traceEvents[1].setupPayload.systemPromptChars, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records optional transcript availability without using it for pricing', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('debug-log-with-transcript');
  const transcriptDir = join(workspaceDir, 'GitHub.copilot-chat', 'transcripts');
  try {
    mkdirSync(transcriptDir, { recursive: true });
    writeJsonl(join(transcriptDir, 'debug-log-with-transcript.jsonl'), [
      { type: 'assistant.turn_start' },
      { type: 'tool.execution_complete', toolName: 'read_file' },
    ]);
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Read one file.' } }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: { model: 'gpt-5.4', inputTokens: 10_000, cachedTokens: 7_500, outputTokens: 100 },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);

    assert.equal(session.transcript.available, true);
    assert.equal(session.transcript.eventCount, 2);
    assert.match(session.transcript.sourcePath, /debug-log-with-transcript\.jsonl$/);
    assert.deepEqual(session.tokens, {
      input: 2_500,
      cachedInput: 7_500,
      cacheWrite: 0,
      output: 100,
    });
    assert.equal(session.traceSummary.totalTokens, 10_100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('imports mixed-model debug-log sessions without flattening model rows', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('mixed-model-debug-log');
  try {
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Compare two approaches.' } }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: { model: 'gpt-5.4', inputTokens: 10_000, outputTokens: 500 },
      }),
      event(3, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'claude-sonnet-4.6',
          inputTokens: 12_000,
          cachedTokens: 2_000,
          outputTokens: 700,
        },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);
    const rows = session.modelBreakdown;

    assert.equal(session.model, 'Mixed (GPT-5.4, Claude Sonnet 4.6)');
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.model === 'GPT-5.4').tokens.input, 10_000);
    assert.equal(rows.find((row) => row.model === 'Claude Sonnet 4.6').tokens.input, 10_000);
    assert.equal(rows.find((row) => row.model === 'Claude Sonnet 4.6').tokens.cachedInput, 2_000);
    assert.equal(session.tokens.input, 20_000);
    assert.equal(session.tokens.cachedInput, 2_000);
    assert.equal(session.traceSummary.modelTurns, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips empty debug-log sessions instead of inventing weak estimates', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('empty-debug-log');
  try {
    writeFileSync(join(sessionDir, 'main.jsonl'), '', 'utf8');

    assert.equal(sessionFromDebugLog(sessionDir, workspaceDir), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps chat snapshots visibly estimated and cache-empty', () => {
  const { root, workspaceDir } = tempWorkspaceFixture('weak-chat-snapshot');
  const snapshotFile = join(workspaceDir, 'chatSessions', 'snapshot-1.jsonl');
  mkdirSync(join(workspaceDir, 'chatSessions'), { recursive: true });

  try {
    writeJsonl(snapshotFile, [
      {
        kind: 0,
        v: {
          creationDate: Date.UTC(2026, 4, 1),
          customTitle: 'Visible chat only',
          requests: [
            {
              modelId: 'gpt-5.4',
              message: { text: 'Summarize this file.' },
              completionTokens: 120,
              response: [{ value: 'Done.' }],
            },
          ],
        },
      },
    ]);

    const session = sessionFromChatSnapshot(snapshotFile, workspaceDir);

    assert.equal(session.sourceKind, 'vscode-chat-session-snapshot');
    assert.equal(session.tokenSource, 'chat-snapshot-output-plus-visible-input-estimate');
    assert.equal(session.confidence, 'estimated');
    assert.equal(session.tokens.cachedInput, 0);
    assert.equal(session.cacheTokenAudit.modelCalls, 0);
    assert.equal(session.transcript.available, false);
    assert.equal(session.traceEvents.length, 2);
    assert.equal(session.traceEvents[0].type, 'user_message');
    assert.equal(session.traceEvents[1].outputTokens, 120);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('indexes Copilot customizations and classifies request evidence', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('customization-evidence');
  const workspaceFolder = join(root, 'example-workspace');
  const instructionsDir = join(workspaceFolder, '.github', 'instructions');
  const skillsDir = join(workspaceFolder, '.github', 'skills');

  try {
    mkdirSync(instructionsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      join(instructionsDir, 'backend.instructions.md'),
      [
        '---',
        'applyTo: src/**/*.cs',
        'description: Backend aggregate rule.',
        '---',
        '',
        'Always create aggregates with validators and domain events.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(skillsDir, 'review.SKILL.md'),
      [
        '---',
        'title: Review Skill',
        'id: review-skill',
        'description: Review code for release safety.',
        '---',
        '',
        'When reviewing code, check migrations, rollback, and auth boundaries.',
      ].join('\n'),
      'utf8',
    );
    mkdirSync(join(skillsDir, 'node_modules', 'accidental-package'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'node_modules', 'accidental-package', 'SHOULD-NOT-SCAN.md'),
      'This dependency markdown file must not be imported as a customization.',
      'utf8',
    );
    writeFileSync(
      join(sessionDir, 'system_prompt_0.json'),
      JSON.stringify({
        content: [
          {
            type: 'text',
            content:
              '<instruction><file>backend.instructions.md</file><description>Backend aggregate rule.</description><applyTo>src/**/*.cs</applyTo></instruction>',
          },
        ],
      }),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Review the backend.' } }),
      event(1.5, 'tool_call', 'read_file', {
        attrs: { details: `Read ${join(instructionsDir, 'backend.instructions.md')}` },
      }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          systemPromptFile: 'system_prompt_0.json',
          inputMessages:
            'The active instruction says: Always create aggregates with validators and domain events.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({ roots: [workspaceDir], sqlite: false });
    const instruction = data.customizations.find((item) => item.kind === 'instruction');
    const skill = data.customizations.find((item) => item.kind === 'skill');

    assert.equal(data.ingestion.importedCustomizations, 2);
    assert.equal(data.customizations.some((item) => item.relativePath.includes('node_modules')), false);
    assert.equal(instruction.evidenceStatus, 'sent');
    assert.equal(instruction.matches.some((match) => match.status === 'sent'), true);
    assert.equal(skill.evidenceStatus, 'not_seen');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('can skip customization indexing for lightweight extension scans', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('skip-customization-evidence');
  const workspaceFolder = join(root, 'example-workspace');
  const instructionsDir = join(workspaceFolder, '.github', 'instructions');
  const events = [];

  try {
    mkdirSync(instructionsDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      join(instructionsDir, 'backend.instructions.md'),
      'Always create aggregates with validators and domain events.',
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          inputMessages:
            'The active instruction says: Always create aggregates with validators and domain events.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      includeCustomizations: false,
      onProgress: (progress) => events.push(progress),
    });

    assert.equal(data.customizations.length, 0);
    assert.equal(data.ingestion.importedCustomizations, 0);
    assert.equal(data.ingestion.customizationEvidenceModelCalls, 0);
    assert.equal(events.some((progress) => progress.stage === 'customizations'), false);
    assert.equal(events.some((progress) => progress.stage === 'customization-evidence'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict VS Code customization discovery scans only API-provided locations', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('strict-customization-discovery');
  const workspaceFolder = join(root, 'example-workspace');
  const allowedInstructionsDir = join(workspaceFolder, '.github', 'instructions');
  const ignoredSkillsDir = join(workspaceFolder, '.github', 'skills');
  const userSkillsDir = join(root, 'user-copilot-skills');

  try {
    mkdirSync(allowedInstructionsDir, { recursive: true });
    mkdirSync(ignoredSkillsDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      join(allowedInstructionsDir, 'backend.instructions.md'),
      'Allowed instruction text from the VS Code default location.',
      'utf8',
    );
    writeFileSync(
      join(allowedInstructionsDir, 'plain-backend-rule.md'),
      'Plain markdown instruction text from a trusted VS Code instructions location.',
      'utf8',
    );
    writeFileSync(
      join(ignoredSkillsDir, 'ignored.SKILL.md'),
      'This workspace skill should not be imported without a VS Code discovery entry.',
      'utf8',
    );
    writeFileSync(
      join(userSkillsDir, 'SKILL.md'),
      'User configured skill text from an explicit VS Code setting.',
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(0.5, 'tool_call', 'read_file', {
        attrs: {
          details: [
            `Read ${join(allowedInstructionsDir, 'backend.instructions.md')}`,
            `Read ${join(allowedInstructionsDir, 'plain-backend-rule.md')}`,
            `Read ${join(userSkillsDir, 'SKILL.md')}`,
          ].join('\n'),
        },
      }),
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          inputMessages:
            'Allowed instruction text from the VS Code default location. Plain markdown instruction text from a trusted VS Code instructions location. User configured skill text from an explicit VS Code setting.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      customizationDiscovery: {
        strict: true,
        locations: [
          {
            path: allowedInstructionsDir,
            kind: 'instruction',
            source: 'vscode-default',
            settingKey: 'chat.instructionsFilesLocations',
            rawLocation: '.github/instructions',
            workspaceFolder,
          },
          {
            path: userSkillsDir,
            kind: 'skill',
            source: 'vscode-user-setting',
            settingKey: 'chat.agentSkillsLocations',
            rawLocation: userSkillsDir,
            workspaceFolder,
          },
        ],
      },
    });

    const paths = data.customizations.map((item) => item.sourcePath);
    assert.equal(paths.includes(join(allowedInstructionsDir, 'backend.instructions.md')), true);
    assert.equal(paths.includes(join(allowedInstructionsDir, 'plain-backend-rule.md')), true);
    assert.equal(paths.includes(join(userSkillsDir, 'SKILL.md')), true);
    assert.equal(paths.includes(join(ignoredSkillsDir, 'ignored.SKILL.md')), false);
    assert.equal(data.customizations.length, 3);
    assert.equal(
      data.customizations.find((item) => item.sourcePath === join(allowedInstructionsDir, 'plain-backend-rule.md'))
        ?.evidenceStatus,
      'sent',
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'vscode-default-root'),
      true,
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'vscode-user-setting-root'),
      true,
    );
    assert.equal(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'root'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict VS Code customization discovery trusts explicit file locations without broad profile scanning', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('strict-explicit-customization-file');
  const userProfileLikeFolder = join(root, 'Users', 'example');
  const workspaceFolder = join(root, 'repo');
  const explicitInstructionFile = join(userProfileLikeFolder, 'my-copilot-rule.md');
  const unconfiguredInstructionFile = join(userProfileLikeFolder, 'AGENTS.md');

  try {
    mkdirSync(userProfileLikeFolder, { recursive: true });
    mkdirSync(workspaceFolder, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      explicitInstructionFile,
      'Always review the payment boundary before changing the checkout API.',
      'utf8',
    );
    writeFileSync(
      unconfiguredInstructionFile,
      'This broad profile instruction must not be imported unless VS Code explicitly points at it.',
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(0.5, 'tool_call', 'read_file', {
        attrs: { details: `Read ${explicitInstructionFile}` },
      }),
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          inputMessages: 'Always review the payment boundary before changing the checkout API.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      customizationDiscovery: {
        strict: true,
        locations: [
          {
            path: explicitInstructionFile,
            kind: 'instruction',
            source: 'vscode-user-setting',
            settingKey: 'chat.instructionsFilesLocations',
            rawLocation: explicitInstructionFile,
            workspaceFolder,
          },
        ],
      },
    });

    const explicitInstruction = data.customizations.find(
      (item) => item.sourcePath === explicitInstructionFile,
    );

    assert.equal(explicitInstruction?.kind, 'instruction');
    assert.equal(explicitInstruction?.evidenceStatus, 'sent');
    assert.equal(
      data.customizations.some((item) => item.sourcePath === unconfiguredInstructionFile),
      false,
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some(
        (location) => location.path === resolve(userProfileLikeFolder) && location.kind !== 'debug-reference',
      ),
      false,
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some(
        (location) => location.path === resolve(explicitInstructionFile) && location.kind === 'vscode-user-setting-root',
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict VS Code customization discovery imports copilot instructions and separates text-match evidence from inventory', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('strict-copilot-instructions-evidence');
  const workspaceFolder = join(root, 'repo-with-copilot-instructions');
  const instructionFile = join(workspaceFolder, '.github', 'copilot-instructions.md');

  try {
    mkdirSync(dirname(instructionFile), { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      instructionFile,
      [
        '# Copilot instructions',
        '',
        'Always explain payment aggregate invariants before changing code paths.',
        'Prefer small repository-safe edits with visible verification steps.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(sessionDir, 'system_prompt_0.json'),
      JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'Always explain payment aggregate invariants before changing code paths.',
          },
        ],
      }),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(0.5, 'tool_call', 'read_file', {
        attrs: { details: `Read ${instructionFile}` },
      }),
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          systemPromptFile: 'system_prompt_0.json',
          inputMessages: 'Update the checkout flow.',
        },
      }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 1_000,
          outputTokens: 100,
          inputMessages:
            'The request referenced .github/copilot-instructions.md but did not include the visible instruction body.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      customizationDiscovery: {
        strict: true,
        locations: [
          {
            path: instructionFile,
            kind: 'instruction',
            source: 'vscode-default',
            settingKey: 'github.copilot.chat.codeGeneration.useInstructionFiles',
            rawLocation: '.github/copilot-instructions.md',
            workspaceFolder,
          },
        ],
      },
    });

    const instruction = data.customizations.find((item) => item.sourcePath === instructionFile);
    assert.equal(instruction?.kind, 'instruction');
    assert.equal(instruction?.relativePath, 'copilot-instructions.md');
    assert.equal(instruction?.evidenceStatus, 'sent');
    assert.equal(instruction?.matches.some((match) => match.status === 'sent'), true);
    assert.equal(instruction?.matches.some((match) => match.status === 'listed'), true);
    assert.equal(instruction?.matches.some((match) => match.source === 'system_prompt_0.json'), true);
    assert.equal(
      instruction?.matches.some(
        (match) => match.status === 'listed' && match.source === 'copilotFileRead',
      ),
      true,
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'vscode-default-root'),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict VS Code customization discovery does not overclaim copilot instructions when request text is absent', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('strict-copilot-instructions-no-match');
  const workspaceFolder = join(root, 'repo-with-unmatched-copilot-instructions');
  const instructionFile = join(workspaceFolder, '.github', 'copilot-instructions.md');

  try {
    mkdirSync(dirname(instructionFile), { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      instructionFile,
      'Always explain payment aggregate invariants before changing code paths.',
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 2_000,
          outputTokens: 100,
          inputMessages: 'Update the checkout flow without any visible instruction text.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      customizationDiscovery: {
        strict: true,
        locations: [
          {
            path: instructionFile,
            kind: 'instruction',
            source: 'vscode-default',
            settingKey: 'github.copilot.chat.codeGeneration.useInstructionFiles',
            rawLocation: '.github/copilot-instructions.md',
            workspaceFolder,
          },
        ],
      },
    });

    const instruction = data.customizations.find((item) => item.sourcePath === instructionFile);
    assert.equal(instruction?.kind, 'instruction');
    assert.equal(instruction?.evidenceStatus, 'not_seen');
    assert.deepEqual(instruction?.matches, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('indexes repo-root, parent-repo, agent, and debug-referenced customizations', async () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('customization-expanded-sources');
  const repoRoot = join(root, 'repo');
  const workspaceFolder = join(repoRoot, 'apps', 'api');
  const externalSkillDir = join(root, 'local-copilot-skill');
  const externalSkillFile = join(externalSkillDir, 'SKILL.md');
  const discoveredSkillDir = join(root, '.copilot', 'skills', 'pending-git');
  const discoveredSkillFile = join(discoveredSkillDir, 'SKILL.md');
  const configuredInstructionsDir = join(workspaceFolder, 'custom', 'copilot-rules');
  const configuredInstructionFile = join(configuredInstructionsDir, 'domain.instructions.md');
  const configuredSkillsDir = join(workspaceFolder, 'custom', 'copilot-skills');
  const configuredSkillFile = join(configuredSkillsDir, 'release-review', 'SKILL.md');
  const configuredAgentsDir = join(workspaceFolder, 'custom', 'copilot-agents');
  const configuredAgentFile = join(configuredAgentsDir, 'release-planner.agent.md');
  const systemSkillDir = join(root, '.vscode', 'extensions', 'publisher.extension-1.0.0', 'skills', 'system-skill');
  const systemSkillFile = join(systemSkillDir, 'SKILL.md');

  try {
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    mkdirSync(join(repoRoot, '.github', 'instructions'), { recursive: true });
    mkdirSync(join(repoRoot, '.github', 'agents'), { recursive: true });
    mkdirSync(join(repoRoot, '.agents', 'skills', 'local-review'), { recursive: true });
    mkdirSync(join(repoRoot, '.claude', 'rules'), { recursive: true });
    mkdirSync(workspaceFolder, { recursive: true });
    mkdirSync(join(workspaceFolder, '.vscode'), { recursive: true });
    mkdirSync(externalSkillDir, { recursive: true });
    mkdirSync(discoveredSkillDir, { recursive: true });
    mkdirSync(configuredInstructionsDir, { recursive: true });
    mkdirSync(dirname(configuredSkillFile), { recursive: true });
    mkdirSync(configuredAgentsDir, { recursive: true });
    mkdirSync(systemSkillDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      join(workspaceFolder, '.vscode', 'settings.json'),
      JSON.stringify(
        {
          'chat.instructionsFilesLocations': {
            'custom/copilot-rules': true,
          },
          'chat.agentSkillsLocations': {
            'custom/copilot-skills': true,
            [systemSkillDir]: true,
          },
          'chat.agentFilesLocations': {
            'custom/copilot-agents': true,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(repoRoot, '.github', 'copilot-instructions.md'),
      'Prefer repository aggregate rules and keep controllers thin.',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, 'AGENTS.md'),
      'Repository agents must ask one clarifying question before plans.',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, '.github', 'instructions', 'parent.instructions.md'),
      'Parent instruction: use bounded context and explicit domain language.',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, '.github', 'agents', 'planner.agent.md'),
      'Planner agent should produce small phases and visible risks.',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, '.agents', 'skills', 'local-review', 'SKILL.md'),
      'Review pending local changes before making risky edits.',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, '.claude', 'rules', 'team.instructions.md'),
      'Team rule: state repository assumptions before changing behavior.',
      'utf8',
    );
    writeFileSync(
      externalSkillFile,
      'When pending git changes exist, summarize risk before editing.',
      'utf8',
    );
    writeFileSync(
      discoveredSkillFile,
      'Pending git changes skill: compare changed files and summarize risk first.',
      'utf8',
    );
    writeFileSync(
      configuredInstructionFile,
      'Configured instruction: always explain aggregate invariants before coding.',
      'utf8',
    );
    writeFileSync(
      configuredSkillFile,
      'Configured release skill: inspect changelog, package metadata, and release risk.',
      'utf8',
    );
    writeFileSync(
      configuredAgentFile,
      'Configured release planner agent: produce release checks before publishing.',
      'utf8',
    );
    writeFileSync(
      systemSkillFile,
      'System extension skill: this is useful but should not appear in default customization scans.',
      'utf8',
    );
    writeFileSync(
      join(sessionDir, 'system_prompt_0.json'),
      JSON.stringify({
        content: [
          {
            type: 'text',
            content: [
              '<file>.github/copilot-instructions.md</file>',
              `<file>${externalSkillFile}</file>`,
              'Planner agent should produce small phases and visible risks.',
              'When pending git changes exist, summarize risk before editing.',
              'Pending git changes skill: compare changed files and summarize risk first.',
              'Configured instruction: always explain aggregate invariants before coding.',
              'Configured release skill: inspect changelog, package metadata, and release risk.',
              'Configured release planner agent: produce release checks before publishing.',
              'System extension skill: this is useful but should not appear in default customization scans.',
            ].join('\n'),
          },
        ],
      }),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(0, 'discovery', 'Skill Discovery', {
        attrs: {
          details: `Resolved 1 skills in 10ms | loaded: [pending-git] | folders: [${dirname(discoveredSkillFile)}]`,
        },
      }),
      event(0.5, 'tool_call', 'read_file', {
        attrs: {
          details: [
            `Read ${join(repoRoot, '.github', 'copilot-instructions.md')}`,
            `Read ${externalSkillFile}`,
            `Read ${discoveredSkillFile}`,
            `Read ${join(repoRoot, '.github', 'agents', 'planner.agent.md')}`,
            `Read ${configuredInstructionFile}`,
            `Read ${configuredSkillFile}`,
            `Read ${configuredAgentFile}`,
            `Read ${systemSkillFile}`,
          ].join('\n'),
        },
      }),
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 1_200,
          outputTokens: 80,
          systemPromptFile: 'system_prompt_0.json',
          inputMessages: 'Prefer repository aggregate rules and keep controllers thin.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({ roots: [workspaceDir], sqlite: false });
    const paths = data.customizations.map((item) => item.relativePath.replace(/\\/g, '/')).sort();
    const externalSkill = data.customizations.find((item) => item.sourcePath === externalSkillFile);
    const discoveredSkill = data.customizations.find((item) => item.sourcePath === discoveredSkillFile);
    const configuredInstruction = data.customizations.find((item) => item.sourcePath === configuredInstructionFile);
    const configuredSkill = data.customizations.find((item) => item.sourcePath === configuredSkillFile);
    const configuredAgent = data.customizations.find((item) => item.sourcePath === configuredAgentFile);
    const systemSkill = data.customizations.find((item) => item.sourcePath === systemSkillFile);

    assert(paths.includes('.github/copilot-instructions.md'));
    assert(paths.includes('AGENTS.md'));
    assert(paths.includes('.github/instructions/parent.instructions.md'));
    assert(paths.includes('.github/agents/planner.agent.md'));
    assert(paths.includes('.agents/skills/local-review/SKILL.md'));
    assert(paths.includes('.claude/rules/team.instructions.md'));
    assert(paths.includes('domain.instructions.md'));
    assert(paths.includes('release-review/SKILL.md'));
    assert(paths.includes('release-planner.agent.md'));
    assert.equal(data.customizations.some((item) => item.kind === 'agent'), true);
    assert.equal(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'candidate'), false);
    assert(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'root'));
    assert(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'file'));
    assert(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'debug-reference'));
    assert(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'debug-discovery-root'));
    assert(data.ingestion.scannedCustomizationLocations.some((location) => location.kind === 'vscode-setting-root'));
    assert.equal(data.ingestion.importedCustomizations, data.customizations.length);
    assert.equal(systemSkill, undefined);
    assert.equal(data.ingestion.skippedSystemCustomizations > 0, true);
    assert.equal(externalSkill?.kind, 'skill');
    assert.equal(externalSkill?.evidenceStatus, 'sent');
    assert.equal(discoveredSkill?.kind, 'skill');
    assert.equal(discoveredSkill?.evidenceStatus, 'sent');
    assert.equal(configuredInstruction?.kind, 'instruction');
    assert.equal(configuredInstruction?.evidenceStatus, 'sent');
    assert.equal(configuredSkill?.kind, 'skill');
    assert.equal(configuredSkill?.evidenceStatus, 'sent');
    assert.equal(configuredAgent?.kind, 'agent');
    assert.equal(configuredAgent?.evidenceStatus, 'sent');

    const dataWithSystem = await scanVsCodeSessions({
      roots: [workspaceDir],
      sqlite: false,
      includeSystemCustomizations: true,
    });
    const includedSystemSkill = dataWithSystem.customizations.find((item) => item.sourcePath === systemSkillFile);
    assert.equal(includedSystemSkill?.kind, 'skill');
    assert.equal(includedSystemSkill?.evidenceStatus, 'sent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('indexes VS Code user-level customizations and matches request side-file evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-user-customizations-'));
  const userDir = join(root, 'Code', 'User');
  const workspaceDir = join(userDir, 'workspaceStorage', 'workspace-one');
  const sessionDir = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', 'user-customization-session');
  const workspaceFolder = join(root, 'repo');
  const promptFile = join(userDir, 'prompts', 'release.prompt.md');

  try {
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(workspaceFolder, { recursive: true });
    mkdirSync(join(userDir, 'prompts'), { recursive: true });
    writeFileSync(
      join(userDir, 'settings.json'),
      JSON.stringify(
        {
          'chat.promptFilesLocations': {
            [promptFile]: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      promptFile,
      'Before publishing a release, check package version, changelog notes, and VSIX artifacts.',
      'utf8',
    );
    writeFileSync(
      join(sessionDir, 'tools_0.json'),
      JSON.stringify({
        content: [
          {
            type: 'function',
            name: 'release_prompt',
            description:
              'Before publishing a release, check package version, changelog notes, and VSIX artifacts.',
          },
        ],
      }),
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(0.5, 'tool_call', 'read_file', {
        attrs: { details: `Read ${promptFile}` },
      }),
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 1_200,
          outputTokens: 80,
          toolsFile: 'tools_0.json',
          inputMessages: 'Prepare the release.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({ roots: [workspaceDir], sqlite: false });
    const prompt = data.customizations.find((item) => item.sourcePath === promptFile);

    assert.equal(prompt?.kind, 'prompt');
    assert.equal(prompt?.evidenceStatus, 'sent');
    assert.equal(prompt?.matches.some((match) => match.source === 'tools_0.json'), true);
    assert(data.ingestion.customizationEvidenceTextParts > 0);
    assert(data.ingestion.customizationEvidenceMatchedCustomizations > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat the whole user profile as a customization root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-no-home-customizations-'));
  const userDir = join(root, 'Code', 'User');
  const workspaceDir = join(userDir, 'workspaceStorage', 'workspace-one');
  const sessionDir = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', 'home-profile-session');
  const workspaceFolder = join(root, 'repo');
  const profileInstruction = join(root, 'AGENTS.md');

  try {
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(workspaceFolder, { recursive: true });
    writeFileSync(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: pathToFileUrl(workspaceFolder) }),
      'utf8',
    );
    writeFileSync(
      profileInstruction,
      'This user-profile instruction should not be imported unless a setting points at it.',
      'utf8',
    );
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 1_200,
          outputTokens: 80,
          inputMessages: 'Inspect this workspace.',
        },
      }),
    ]);

    const data = await scanVsCodeSessions({ roots: [workspaceDir], sqlite: false });

    assert.equal(data.customizations.some((item) => item.sourcePath === profileInstruction), false);
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some((location) => location.path === resolve(homedir())),
      false,
    );
    assert.equal(
      data.ingestion.scannedCustomizationLocations.some((location) => location.path === resolve(userDir)),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanner CLI accepts explicit root and output flags', async () => {
  const calls = [];
  const logs = [];
  const root = mkdtempSync(join(tmpdir(), 'copilot-usage-studio-cli-root-'));
  const output = join(root, 'out.json');

  try {
    const result = await runScannerCli(
      ['--root', root, '--output', output],
      { log: (message) => logs.push(message) },
      {
        scanner: async (options) => {
          calls.push(options);
          return { sessions: [] };
        },
        writer: (data, outputFile) => {
          calls.push({ data, outputFile });
          return outputFile;
        },
      },
    );

    assert.deepEqual(result, { sessions: [] });
    assert.deepEqual(calls[0], { roots: [root] });
    assert.equal(calls[1].outputFile, output);
    assert.match(logs[0], /Wrote 0 sessions/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function pathToFileUrl(file) {
  return `file://${file.replace(/\\/g, '/')}`;
}

function tempSessionFixture(name) {
  const fixture = tempWorkspaceFixture(name);
  const sessionDir = join(fixture.workspaceDir, 'GitHub.copilot-chat', 'debug-logs', name);
  mkdirSync(sessionDir, { recursive: true });

  return { ...fixture, sessionDir };
}

function tempWorkspaceFixture(name) {
  const root = mkdtempSync(join(tmpdir(), `copilot-usage-studio-${name}-`));
  const workspaceDir = join(root, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(
    join(workspaceDir, 'workspace.json'),
    JSON.stringify({ folder: 'file:///tmp/example-workspace' }),
    'utf8',
  );

  return { root, workspaceDir };
}

function writeJsonl(file, records) {
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');
}

function event(ts, type, name, extra = {}) {
  return {
    ts,
    timestamp: new Date(ts).toISOString(),
    sid: 'fixture-session',
    type,
    name,
    status: 'ok',
    attrs: {},
    ...extra,
  };
}
