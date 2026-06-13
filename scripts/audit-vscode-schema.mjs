import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fingerprintVersion = 1;
const defaultBaseline = resolve('data/vscode-schema-baseline.json');
const defaultJsonReport = resolve('tmp/schema-audit.json');
const defaultMarkdownReport = resolve('tmp/schema-audit.md');

const criticalLlmFields = ['model', 'inputTokens', 'outputTokens'];
const importantLlmFields = ['cachedTokens', 'copilotUsageNanoAiu', 'requestOptions', 'requestShape'];

function parseArgs(argv) {
  const options = {
    sessions: [],
    roots: [],
    baseline: defaultBaseline,
    json: defaultJsonReport,
    markdown: defaultMarkdownReport,
    accept: false,
    allowBreaking: false,
    maxSessions: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--session') options.sessions.push(resolve(argv[++index]));
    else if (argument === '--root') options.roots.push(resolve(argv[++index]));
    else if (argument === '--baseline') options.baseline = resolve(argv[++index]);
    else if (argument === '--json') options.json = resolve(argv[++index]);
    else if (argument === '--markdown') options.markdown = resolve(argv[++index]);
    else if (argument === '--max-sessions') options.maxSessions = Math.max(1, Number(argv[++index]) || 25);
    else if (argument === '--accept') options.accept = true;
    else if (argument === '--allow-breaking') options.allowBreaking = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function defaultCodeUserDirs() {
  const home = homedir();
  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appData, 'Code', 'User'), join(appData, 'Code - Insiders', 'User')];
  }
  if (platform() === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'),
    ];
  }
  return [join(home, '.config', 'Code', 'User'), join(home, '.config', 'Code - Insiders', 'User')];
}

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

function discoverSessionDirs(roots) {
  const found = new Set();
  for (const root of roots) {
    if (existsSync(join(root, 'main.jsonl'))) {
      found.add(root);
      continue;
    }

    const workspaceStorage = basename(root).toLowerCase() === 'workspacestorage' ? root : join(root, 'workspaceStorage');
    const workspaces = existsSync(join(root, 'GitHub.copilot-chat')) ? [root] : directories(workspaceStorage);
    for (const workspace of workspaces) {
      for (const session of directories(join(workspace, 'GitHub.copilot-chat', 'debug-logs'))) {
        if (existsSync(join(session, 'main.jsonl'))) found.add(session);
      }
    }
  }
  return [...found];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJsonl(file) {
  const records = [];
  let parseErrors = 0;
  if (!existsSync(file)) return { records, parseErrors: 1 };
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const parsed = safeJson(line);
    if (parsed) records.push(parsed);
    else parseErrors += 1;
  }
  return { records, parseErrors };
}

function runtimeForSession(sessionDir) {
  const { records } = readJsonl(join(sessionDir, 'main.jsonl'));
  const start = records.find((record) => record.type === 'session_start') ?? {};
  return {
    logVersion: Number(start.v ?? 0) || 0,
    vscodeVersion: String(start.attrs?.vscodeVersion ?? ''),
    copilotVersion: String(start.attrs?.copilotVersion ?? ''),
  };
}

function selectRuntimeCohort(sessionDirs, maxSessions) {
  const candidates = sessionDirs
    .map((sessionDir) => ({
      sessionDir,
      modifiedAt: statSync(join(sessionDir, 'main.jsonl')).mtime.toISOString(),
      runtime: runtimeForSession(sessionDir),
      hasLlmRequest: readJsonl(join(sessionDir, 'main.jsonl')).records.some((record) => record.type === 'llm_request'),
    }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const latest = candidates.find((candidate) => candidate.hasLlmRequest) ?? candidates[0];
  if (!latest) return [];

  const runtimeMatches = candidates.filter(
    (candidate) =>
      candidate.runtime.vscodeVersion === latest.runtime.vscodeVersion &&
      candidate.runtime.copilotVersion === latest.runtime.copilotVersion,
  );
  return runtimeMatches.slice(0, maxSessions);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function addType(target, field, value) {
  if (!target.has(field)) target.set(field, new Set());
  target.get(field).add(valueType(value));
}

function addShape(target, value, prefix = '', depth = 0) {
  if (depth > 7 || value === undefined) return;
  if (Array.isArray(value)) {
    addType(target, prefix || '[]', value);
    for (const item of value.slice(0, 20)) addShape(target, item, `${prefix}[]`, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (prefix) addType(target, prefix, value);
    return;
  }
  if (prefix) addType(target, prefix, value);
  for (const [key, nested] of Object.entries(value)) {
    addShape(target, nested, prefix ? `${prefix}.${key}` : key, depth + 1);
  }
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => value !== '' && value !== undefined && value !== null))].sort();
}

function shapeObject(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, types]) => [field, [...types].sort()]),
  );
}

function coverage(present, total) {
  if (!total || !present) return 'none';
  return present === total ? 'all' : 'some';
}

function parseEmbedded(value) {
  if (typeof value !== 'string') return value;
  return safeJson(value) ?? null;
}

function contentFromSideFile(file) {
  const envelope = safeJson(readFileSync(file, 'utf8'));
  return { envelope, content: parseEmbedded(envelope?.content ?? envelope) };
}

export function buildSchemaFingerprint(sessionDirs) {
  const sessions = sessionDirs.map((sessionDir) => ({
    sessionDir,
    modifiedAt: statSync(join(sessionDir, 'main.jsonl')).mtime.toISOString(),
    runtime: runtimeForSession(sessionDir),
  }));
  const eventTypes = new Map();
  const envelopeShape = new Map();
  const requestOptionsShape = new Map();
  const requestShape = new Map();
  const modelShape = new Map();
  const systemEnvelopeShape = new Map();
  const systemContentShape = new Map();
  const toolEnvelopeShape = new Map();
  const toolContentShape = new Map();
  const childEventShape = new Map();
  const modelIds = [];
  const semanticEventNames = [];
  const requestApis = [];
  const requestItemTypes = [];
  const reasoningEfforts = [];
  const textVerbosities = [];
  const childLogKinds = [];
  let records = 0;
  let parseErrors = 0;
  let llmRequests = 0;
  let invalidNumericTokenFields = 0;
  let invalidCachedTokenSplits = 0;
  const fieldPresence = Object.fromEntries([...criticalLlmFields, ...importantLlmFields].map((field) => [field, 0]));
  let modelsFiles = 0;
  let systemPromptFiles = 0;
  let toolsFiles = 0;
  let toolDefinitions = 0;

  for (const { sessionDir } of sessions) {
    const main = readJsonl(join(sessionDir, 'main.jsonl'));
    records += main.records.length;
    parseErrors += main.parseErrors;

    for (const event of main.records) {
      addShape(envelopeShape, event);
      const type = String(event.type ?? 'unknown');
      const schema = eventTypes.get(type) ?? {
        count: 0,
        eventFields: new Map(),
        attrFields: new Map(),
        dataFields: new Map(),
      };
      schema.count += 1;
      for (const [key, value] of Object.entries(event)) if (!['attrs', 'data'].includes(key)) addType(schema.eventFields, key, value);
      for (const [key, value] of Object.entries(event.attrs ?? {})) addType(schema.attrFields, key, value);
      for (const [key, value] of Object.entries(event.data ?? {})) addType(schema.dataFields, key, value);
      eventTypes.set(type, schema);

      if (
        event.name &&
        (type === 'discovery' || /discovery|customiz|resolve/i.test(String(event.name)))
      ) {
        semanticEventNames.push(`${type}:${event.name}`);
      }
      if (type !== 'llm_request') continue;

      llmRequests += 1;
      for (const field of Object.keys(fieldPresence)) if (event.attrs?.[field] !== undefined) fieldPresence[field] += 1;
      for (const field of ['inputTokens', 'cachedTokens', 'outputTokens', 'copilotUsageNanoAiu']) {
        if (event.attrs?.[field] !== undefined && !Number.isFinite(Number(event.attrs[field]))) invalidNumericTokenFields += 1;
      }
      if (Number(event.attrs?.cachedTokens ?? 0) > Number(event.attrs?.inputTokens ?? 0)) invalidCachedTokenSplits += 1;

      const options = parseEmbedded(event.attrs?.requestOptions);
      if (options && typeof options === 'object') {
        addShape(requestOptionsShape, options);
        reasoningEfforts.push(options.reasoning?.effort);
        textVerbosities.push(options.text?.verbosity);
      }
      const shape = parseEmbedded(event.attrs?.requestShape);
      if (shape && typeof shape === 'object') {
        addShape(requestShape, shape);
        requestApis.push(shape.api);
        if (Array.isArray(shape.inputItemTypes)) requestItemTypes.push(...shape.inputItemTypes);
      }
    }

    const modelsFile = join(sessionDir, 'models.json');
    if (existsSync(modelsFile)) {
      modelsFiles += 1;
      const models = safeJson(readFileSync(modelsFile, 'utf8'));
      if (Array.isArray(models)) {
        for (const model of models) {
          addShape(modelShape, model);
          modelIds.push(model.id);
        }
      }
    }

    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(sessionDir, entry.name);
      if (/^system_prompt_.*\.json$/i.test(entry.name)) {
        systemPromptFiles += 1;
        const { envelope, content } = contentFromSideFile(file);
        addShape(systemEnvelopeShape, envelope);
        addShape(systemContentShape, content);
      } else if (/^tools_.*\.json$/i.test(entry.name)) {
        toolsFiles += 1;
        const { envelope, content } = contentFromSideFile(file);
        addShape(toolEnvelopeShape, envelope);
        addShape(toolContentShape, content);
        if (Array.isArray(content)) toolDefinitions += content.length;
      } else if (entry.name.endsWith('.jsonl') && entry.name !== 'main.jsonl') {
        const kind = entry.name.startsWith('runSubagent-') ? 'runSubagent' : entry.name.startsWith('title-') ? 'title' : 'other';
        childLogKinds.push(kind);
        const child = readJsonl(file);
        parseErrors += child.parseErrors;
        for (const event of child.records) addShape(childEventShape, event);
      }
    }
  }

  const runtime = sessions[0]?.runtime ?? { logVersion: 0, vscodeVersion: '', copilotVersion: '' };
  return {
    fingerprintVersion,
    capturedAt: new Date().toISOString(),
    runtime,
    cohort: {
      sessionCount: sessions.length,
      newestSessionAt: sessions.map((session) => session.modifiedAt).sort().at(-1) ?? '',
    },
    main: {
      records,
      parseErrors,
      envelopeShape: shapeObject(envelopeShape),
      eventTypes: Object.fromEntries(
        [...eventTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, schema]) => [
          type,
          {
            count: schema.count,
            eventFields: shapeObject(schema.eventFields),
            attrFields: shapeObject(schema.attrFields),
            dataFields: shapeObject(schema.dataFields),
          },
        ]),
      ),
      semanticEventNames: sortedUnique(semanticEventNames),
    },
    llmRequest: {
      count: llmRequests,
      fieldCoverage: Object.fromEntries(Object.entries(fieldPresence).map(([field, present]) => [field, coverage(present, llmRequests)])),
      requestOptionsShape: shapeObject(requestOptionsShape),
      requestShape: shapeObject(requestShape),
      observed: {
        requestApis: sortedUnique(requestApis),
        requestItemTypes: sortedUnique(requestItemTypes),
        reasoningEfforts: sortedUnique(reasoningEfforts),
        textVerbosities: sortedUnique(textVerbosities),
      },
      invariants: { invalidNumericTokenFields, invalidCachedTokenSplits },
    },
    sideFiles: {
      models: { files: modelsFiles, shape: shapeObject(modelShape), modelIds: sortedUnique(modelIds) },
      systemPrompts: {
        files: systemPromptFiles,
        envelopeShape: shapeObject(systemEnvelopeShape),
        contentShape: shapeObject(systemContentShape),
      },
      tools: {
        files: toolsFiles,
        definitions: toolDefinitions,
        envelopeShape: shapeObject(toolEnvelopeShape),
        contentShape: shapeObject(toolContentShape),
      },
      childLogs: { kinds: sortedUnique(childLogKinds), eventShape: shapeObject(childEventShape) },
    },
  };
}

function issue(severity, code, message) {
  return { severity, code, message };
}

function compareStringSets(current = [], baseline = [], label, additions, removals) {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  for (const value of currentSet) if (!baselineSet.has(value)) additions.push(`${label}: ${value}`);
  for (const value of baselineSet) if (!currentSet.has(value)) removals.push(`${label}: ${value}`);
}

function compareShape(current = {}, baseline = {}, label, issues, required = []) {
  const currentFields = new Set(Object.keys(current));
  for (const [field, baselineTypes] of Object.entries(baseline)) {
    if (!currentFields.has(field)) {
      issues.push(issue(required.includes(field) ? 'breaking' : 'warning', 'field-removed', `${label}.${field} was not observed.`));
      continue;
    }
    const currentTypes = current[field] ?? [];
    if (!baselineTypes.some((type) => currentTypes.includes(type))) {
      issues.push(issue(required.includes(field) ? 'breaking' : 'warning', 'field-type-changed', `${label}.${field} changed type from ${baselineTypes.join('|')} to ${currentTypes.join('|')}.`));
    }
  }
  for (const field of currentFields) {
    if (!(field in baseline)) issues.push(issue('info', 'field-added', `${label}.${field} is new.`));
  }
}

export function compareSchemaFingerprints(current, baseline) {
  const issues = [];
  if (current.fingerprintVersion !== baseline.fingerprintVersion) {
    issues.push(issue('breaking', 'fingerprint-version', `Fingerprint version ${current.fingerprintVersion} does not match baseline ${baseline.fingerprintVersion}.`));
  }
  if (current.main.parseErrors > 0) issues.push(issue('breaking', 'parse-errors', `${current.main.parseErrors} JSON/JSONL rows could not be parsed.`));
  if (current.llmRequest.count === 0) issues.push(issue('breaking', 'no-llm-requests', 'No llm_request events were observed in the current runtime cohort.'));
  if (current.llmRequest.invariants.invalidNumericTokenFields > 0) issues.push(issue('breaking', 'invalid-token-types', 'One or more token/usage fields were not numeric.'));
  if (current.llmRequest.invariants.invalidCachedTokenSplits > 0) issues.push(issue('breaking', 'invalid-cache-split', 'cachedTokens exceeded inputTokens on one or more model calls.'));
  if (
    current.runtime.vscodeVersion !== baseline.runtime.vscodeVersion ||
    current.runtime.copilotVersion !== baseline.runtime.copilotVersion
  ) {
    issues.push(
      issue(
        'info',
        'runtime-changed',
        `Runtime changed from VS Code ${baseline.runtime.vscodeVersion || 'unknown'} / Copilot Chat ${baseline.runtime.copilotVersion || 'unknown'} to VS Code ${current.runtime.vscodeVersion || 'unknown'} / Copilot Chat ${current.runtime.copilotVersion || 'unknown'}.`,
      ),
    );
  }

  const currentLlm = current.main.eventTypes.llm_request;
  const baselineLlm = baseline.main.eventTypes.llm_request;
  if (!currentLlm) issues.push(issue('breaking', 'llm-event-removed', 'The llm_request event type was not observed.'));
  else if (baselineLlm) compareShape(currentLlm.attrFields, baselineLlm.attrFields, 'llm_request.attrs', issues, criticalLlmFields);

  for (const field of criticalLlmFields) {
    if (current.llmRequest.fieldCoverage[field] === 'none') issues.push(issue('breaking', 'critical-coverage-lost', `${field} was absent from all model calls.`));
    else if (baseline.llmRequest.fieldCoverage[field] === 'all' && current.llmRequest.fieldCoverage[field] === 'some') {
      issues.push(issue('breaking', 'critical-coverage-degraded', `${field} was present on every baseline model call but only some current model calls.`));
    }
  }
  for (const field of importantLlmFields) {
    if (baseline.llmRequest.fieldCoverage[field] !== 'none' && current.llmRequest.fieldCoverage[field] === 'none') {
      issues.push(issue('warning', 'capability-coverage-lost', `${field} was present in the baseline but absent from this runtime cohort.`));
    } else if (baseline.llmRequest.fieldCoverage[field] === 'all' && current.llmRequest.fieldCoverage[field] === 'some') {
      issues.push(issue('warning', 'capability-coverage-degraded', `${field} was present on every baseline model call but only some current model calls.`));
    }
  }

  compareShape(current.llmRequest.requestOptionsShape, baseline.llmRequest.requestOptionsShape, 'requestOptions', issues);
  compareShape(current.llmRequest.requestShape, baseline.llmRequest.requestShape, 'requestShape', issues);
  compareShape(current.sideFiles.models.shape, baseline.sideFiles.models.shape, 'models[]', issues);
  compareShape(current.sideFiles.systemPrompts.contentShape, baseline.sideFiles.systemPrompts.contentShape, 'system_prompt.content', issues);
  compareShape(current.sideFiles.tools.contentShape, baseline.sideFiles.tools.contentShape, 'tools.content', issues);

  for (const [type] of Object.entries(baseline.main.eventTypes)) {
    if (!(type in current.main.eventTypes)) issues.push(issue('warning', 'event-type-not-observed', `Event type ${type} was not observed in the current cohort.`));
  }
  for (const [type] of Object.entries(current.main.eventTypes)) {
    if (!(type in baseline.main.eventTypes)) issues.push(issue('info', 'event-type-added', `Event type ${type} is new.`));
  }

  const additions = [];
  const removals = [];
  compareStringSets(current.main.semanticEventNames, baseline.main.semanticEventNames, 'semantic event', additions, removals);
  compareStringSets(current.sideFiles.models.modelIds, baseline.sideFiles.models.modelIds, 'model', additions, removals);
  compareStringSets(current.llmRequest.observed.requestApis, baseline.llmRequest.observed.requestApis, 'request API', additions, removals);
  compareStringSets(current.llmRequest.observed.requestItemTypes, baseline.llmRequest.observed.requestItemTypes, 'request item type', additions, removals);
  for (const addition of additions) issues.push(issue('info', 'observed-value-added', `${addition} is new.`));
  for (const removal of removals) issues.push(issue('info', 'observed-value-not-seen', `${removal} was not observed in this cohort.`));

  if (baseline.sideFiles.models.files > 0 && current.sideFiles.models.files === 0) issues.push(issue('warning', 'models-file-missing', 'models.json was not observed.'));
  if (baseline.sideFiles.systemPrompts.files > 0 && current.sideFiles.systemPrompts.files === 0) issues.push(issue('warning', 'system-prompt-missing', 'No system_prompt side files were observed.'));
  if (baseline.sideFiles.tools.files > 0 && current.sideFiles.tools.files === 0) issues.push(issue('warning', 'tools-file-missing', 'No tools side files were observed.'));

  return {
    status: issues.some((entry) => entry.severity === 'breaking') ? 'breaking' : issues.some((entry) => entry.severity === 'warning') ? 'review' : 'compatible',
    issues,
    counts: {
      breaking: issues.filter((entry) => entry.severity === 'breaking').length,
      warnings: issues.filter((entry) => entry.severity === 'warning').length,
      info: issues.filter((entry) => entry.severity === 'info').length,
    },
  };
}

export function renderSchemaAuditMarkdown(report) {
  const lines = [
    '# VS Code Copilot Schema Audit',
    '',
    `Status: **${report.diff.status.toUpperCase()}**`,
    '',
    `- Current runtime: VS Code ${report.current.runtime.vscodeVersion || 'unknown'}, Copilot Chat ${report.current.runtime.copilotVersion || 'unknown'}`,
    `- Baseline runtime: VS Code ${report.baseline.runtime.vscodeVersion || 'unknown'}, Copilot Chat ${report.baseline.runtime.copilotVersion || 'unknown'}`,
    `- Runtime cohort: ${report.current.cohort.sessionCount} session(s), ${report.current.llmRequest.count} model call(s)`,
    `- Findings: ${report.diff.counts.breaking} breaking, ${report.diff.counts.warnings} warning, ${report.diff.counts.info} informational`,
    '',
    '## Findings',
    '',
  ];
  if (!report.diff.issues.length) lines.push('No schema drift detected.');
  for (const severity of ['breaking', 'warning', 'info']) {
    const entries = report.diff.issues.filter((entry) => entry.severity === severity);
    if (!entries.length) continue;
    lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)}`, '');
    for (const entry of entries) lines.push(`- \`${entry.code}\`: ${entry.message}`);
    lines.push('');
  }
  lines.push(
    '## Coverage',
    '',
    `- Cached-token field: ${report.current.llmRequest.fieldCoverage.cachedTokens}`,
    `- Source AI usage field: ${report.current.llmRequest.fieldCoverage.copilotUsageNanoAiu}`,
    `- Request options: ${report.current.llmRequest.fieldCoverage.requestOptions}`,
    `- Request shape: ${report.current.llmRequest.fieldCoverage.requestShape}`,
    `- Model catalogue files: ${report.current.sideFiles.models.files}`,
    `- System-prompt side files: ${report.current.sideFiles.systemPrompts.files}`,
    `- Tool-schema side files: ${report.current.sideFiles.tools.files}`,
    '',
    'This report contains field names, types, counts, and selected non-user schema enums only. It excludes prompts, responses, file paths, tool arguments, and tool results.',
    '',
  );
  return lines.join('\n');
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/audit-vscode-schema.mjs [--session DIR] [--root DIR] [--accept]');
    return;
  }
  const discovered = options.sessions.length
    ? options.sessions
    : discoverSessionDirs(options.roots.length ? options.roots : defaultCodeUserDirs());
  const cohort = options.sessions.length
    ? options.sessions.map((sessionDir) => ({ sessionDir }))
    : selectRuntimeCohort(discovered, options.maxSessions);
  const sessionDirs = cohort.map((entry) => entry.sessionDir);
  if (!sessionDirs.length) throw new Error('No VS Code Copilot Agent Debug Log sessions were found.');

  const current = buildSchemaFingerprint(sessionDirs);
  if (!existsSync(options.baseline) && !options.accept) throw new Error(`Schema baseline not found: ${options.baseline}`);
  const baseline = existsSync(options.baseline) ? JSON.parse(readFileSync(options.baseline, 'utf8')) : current;
  const diff = compareSchemaFingerprints(current, baseline);
  const report = { generatedAt: new Date().toISOString(), current, baseline, diff };
  writeJson(options.json, report);
  mkdirSync(dirname(options.markdown), { recursive: true });
  writeFileSync(options.markdown, `${renderSchemaAuditMarkdown(report)}\n`, 'utf8');

  if (options.accept) {
    if (current.main.parseErrors || current.llmRequest.invariants.invalidNumericTokenFields || current.llmRequest.invariants.invalidCachedTokenSplits) {
      throw new Error('Refusing to accept a baseline with parse or semantic invariant failures.');
    }
    if (diff.status === 'breaking' && !options.allowBreaking) {
      throw new Error('Refusing to accept breaking schema drift. Fix compatibility first, or use --allow-breaking after an explicit contract migration.');
    }
    writeJson(options.baseline, current);
    console.log(`Accepted schema baseline: ${options.baseline}`);
  }

  console.log(`Schema audit ${diff.status}: ${diff.counts.breaking} breaking, ${diff.counts.warnings} warning, ${diff.counts.info} info.`);
  console.log(`Report: ${options.markdown}`);
  if (diff.status === 'breaking' && !options.accept) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
