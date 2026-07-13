import { fork, spawn } from 'node:child_process';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeSessionData } from './scanner-api.mjs';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const scannerWorkerPath = fileURLToPath(new URL('./scanner-worker.mjs', import.meta.url));

export function createLocalRuntime(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = Number(options.port ?? 4312);
  const dataFile = resolve(options.dataFile ?? 'tmp/local-runtime/sessions.json');
  const seedDataFile = options.seedDataFile === null
    ? null
    : resolve(options.seedDataFile ?? 'public/data/sessions.json');
  const staticDir = resolve(options.staticDir ?? 'dist/copilot-usage-studio/browser');
  const scanOptions = options.scanOptions ?? {};
  const scanner = options.scanner ?? scanInChildProcess;
  const writer = options.writer ?? writeSessionData;
  const openPath = options.openPath ?? openLocalPath;
  const logger = options.logger ?? console;
  const backendOnly = options.backendOnly === true;
  const firstDataWaitMs = Math.max(0, Number(options.firstDataWaitMs ?? 5000));
  const logFile = options.logFile === null ? '' : resolve(options.logFile ?? join(dirname(dataFile), 'runtime.log'));
  const logEntries = [];
  const progressHistory = [];
  const workspaceProgress = new Map();
  let scanProgress = null;

  let sessionData = readCachedSessionData(dataFile, logger)
    ?? (seedDataFile ? readCachedSessionData(seedDataFile, logger) : null);
  let phase = sessionData ? 'ready' : 'empty';
  let lastError = '';
  let lastScanStartedAt = '';
  let lastScanCompletedAt = '';
  let lastScanDurationMs = 0;
  let activeScan = null;
  let activeScanController = null;
  let activeScanId = 0;
  let activeScanMode = '';
  let lastScanMode = '';
  let scanSequence = 0;

  function status() {
    return {
      phase,
      scanning: Boolean(activeScan),
      hasData: Boolean(sessionData),
      sessionCount: sessionData?.sessions?.length ?? 0,
      memoryCount: sessionData?.memories?.length ?? 0,
      generatedAt: sessionData?.generatedAt ?? '',
      lastScanStartedAt,
      lastScanCompletedAt,
      lastScanDurationMs,
      lastError,
      activeScanId,
      activeScanMode,
      lastScanMode,
      scanProgress,
      progressHistory: progressHistory.slice(-40),
      workspaceProgress: [...workspaceProgress.values()],
      logFile,
      recentLogs: logEntries.slice(-12),
    };
  }

  function diagnosticsReport() {
    return {
      status: status(),
      dataFile,
      staticDir,
      seedDataFile,
      logFile,
      scanOptions: summarizeScanOptions(scanOptions),
      progressHistory,
      workspaceProgress: [...workspaceProgress.values()],
      logs: logEntries,
    };
  }

  function refresh(reason = 'manual', refreshOptions = {}) {
    if (activeScan) {
      emitLog('log', `Scan already running; reusing active ${reason} request.`);
      return activeScan;
    }

    const scanMode = normalizeScanMode(refreshOptions.mode ?? 'quick');
    const effectiveScanOptions = scanOptionsForMode(scanMode, scanOptions, sessionData);
    const started = Date.now();
    const scanId = ++scanSequence;
    activeScanId = scanId;
    activeScanMode = scanMode;
    activeScanController = new AbortController();
    lastScanStartedAt = new Date(started).toISOString();
    lastError = '';
    phase = 'scanning';
    progressHistory.length = 0;
    workspaceProgress.clear();
    scanProgress = rememberProgress({
      stage: 'starting',
      message: `Starting scan #${scanId} (${reason}).`,
    }, scanId, reason, lastScanStartedAt);
    emitLog('log', `Starting local data refresh #${scanId} (${reason}).`);

    activeScan = Promise.resolve()
      .then(() =>
        scanner({
          ...effectiveScanOptions,
          signal: activeScanController.signal,
          onProgress: (progress) => {
            scanProgress = rememberProgress(progress, scanId, reason);
            if (progress?.message) {
              emitLog('log', progress.message);
            }
          },
        }),
      )
      .then((nextSessionData) => {
        const changedSessionCount = nextSessionData.sessions?.length ?? 0;
        const finalSessionData = sessionData
          ? scanMode === 'customizations'
            ? mergeCustomizationScan(sessionData, nextSessionData)
            : scanMode === 'quick'
              ? mergeIncrementalScan(sessionData, nextSessionData)
              : preserveCustomizationSnapshot(sessionData, nextSessionData)
          : nextSessionData;
        writer(finalSessionData, dataFile);
        sessionData = finalSessionData;
        phase = 'ready';
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        lastScanMode = scanMode;
        scanProgress = rememberProgress({
          stage: 'complete',
          message: scanResultMessage(scanMode, changedSessionCount, finalSessionData.sessions.length),
          sessions: finalSessionData.sessions.length,
        }, scanId, reason, lastScanCompletedAt);
        emitLog(
          'log',
          `${scanResultMessage(scanMode, changedSessionCount, finalSessionData.sessions.length)} (${lastScanDurationMs}ms).`,
        );
        return finalSessionData;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const stopped = isScanStoppedError(error);
        lastError = stopped ? 'Scan stopped by user.' : message;
        phase = stopped ? (sessionData ? 'ready' : 'stopped') : (sessionData ? 'ready' : 'error');
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        scanProgress = rememberProgress({
          stage: stopped ? 'stopped' : 'failed',
          message: stopped ? 'Scan stopped. Existing data was kept.' : lastError,
        }, scanId, reason, lastScanCompletedAt);
        emitLog(stopped ? 'warn' : 'error', `Local data refresh #${scanId} (${reason}) ${stopped ? 'stopped' : 'failed'}: ${lastError}`);
        if (!stopped && error instanceof Error && error.stack) {
          emitLog('error', error.stack);
        }
        throw error;
      })
      .finally(() => {
        activeScan = null;
        activeScanController = null;
        activeScanId = 0;
        activeScanMode = '';
      });

    return activeScan;
  }

  function cancelScan() {
    if (!activeScan || !activeScanController) {
      return false;
    }
    activeScanController.abort();
    emitLog('warn', 'Local data refresh was stopped by the user.');
    return true;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders());
        response.end();
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(response, 200, status());
      }

      if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
        return sendJson(response, 200, diagnosticsReport());
      }

      if (request.method === 'GET' && url.pathname === '/api/logs') {
        return sendJson(response, 200, {
          logFile,
          entries: logEntries,
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        await waitForFirstData();
        return sessionData
          ? sendJson(response, 200, sessionData)
          : sendJson(response, 503, { error: 'No session data is available yet.', status: status() });
      }

      if (request.method === 'GET' && url.pathname === '/data/sessions.json') {
        await waitForFirstData();
        return sessionData
          ? sendJson(response, 200, sessionData)
          : sendJson(response, 503, { error: 'No session data is available yet.', status: status() });
      }

      if (request.method === 'POST' && url.pathname === '/api/scan') {
        try {
          const body = await readJsonBody(request);
          const nextSessionData = await refresh('manual', body);
          return sendJson(response, 200, { sessionData: nextSessionData, status: status() });
        } catch {
          return sendJson(response, 500, { error: lastError, status: status() });
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/scan/cancel') {
        return sendJson(response, 200, { canceled: cancelScan(), status: status() });
      }

      const memoryAction = url.pathname.match(/^\/api\/memories\/([a-f0-9]{24})\/open$/);
      if (request.method === 'POST' && memoryAction) {
        const memory = sessionData?.memories?.find((candidate) => candidate.id === memoryAction[1]);
        if (!memory) {
          return sendJson(response, 404, { error: 'Memory file not found in the current scan.' });
        }

        const body = await readJsonBody(request);
        const action = body?.action === 'reveal' ? 'reveal' : 'open';
        await openPath(memory.sourcePath, action);
        return sendJson(response, 200, { ok: true, action });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { error: 'Method not allowed.' });
      }

      return serveStaticFile(request, response, staticDir, url.pathname);
    } catch (error) {
      emitLog('error', error instanceof Error ? (error.stack ?? error.message) : String(error));
      return sendJson(response, 500, { error: 'Local runtime request failed.' });
    }
  });

  return {
    address: () => server.address(),
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    }),
    listen: () => new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, host, () => {
        server.off('error', rejectListen);
        const address = server.address();
        emitLog(
          'log',
          backendOnly
            ? `Copilot Usage Studio backend API: http://${host}:${address.port}/ (used by the dev server)`
            : `Copilot Usage Studio local app: http://${host}:${address.port}/`,
        );
        if (logFile) {
          emitLog('log', `Runtime log file: ${logFile}`);
        }
        resolveListen(address);

        if (options.scanOnStart !== false) {
          void refresh('startup', { mode: options.startupScanMode ?? 'quick' }).catch(() => {});
        }
      });
    }),
    refresh,
    cancelScan,
    status,
    diagnostics: diagnosticsReport,
  };

  async function waitForFirstData() {
    if (!sessionData && activeScan) {
      try {
        await waitForActiveScanOrTimeout(activeScan, firstDataWaitMs);
      } catch {
        // The response below reports the retained empty/error state.
      }
    }
  }

  function emitLog(level, message) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message: String(message),
    };
    logEntries.push(entry);
    if (logEntries.length > 200) {
      logEntries.splice(0, logEntries.length - 200);
    }

    if (logFile) {
      try {
        mkdirSync(dirname(logFile), { recursive: true });
        if (!existsSync(logFile)) {
          writeFileSync(logFile, '', 'utf8');
        }
        appendFileSync(logFile, `${entry.at} ${entry.level.toUpperCase()} ${entry.message}\n`, 'utf8');
      } catch {
        // Logging must never prevent the local runtime from starting.
      }
    }

    const sink = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.log;
    if (typeof sink === 'function') {
      sink.call(logger, entry.message);
    }
  }

  function rememberProgress(progress = {}, scanId, reason, updatedAt = new Date().toISOString()) {
    const event = {
      ...progress,
      scanId,
      reason,
      updatedAt,
    };
    progressHistory.push(event);
    if (progressHistory.length > 200) {
      progressHistory.splice(0, progressHistory.length - 200);
    }
    if (event.workspace || event.workspaceDir) {
      const key = event.workspaceDir || event.workspace;
      const existing = workspaceProgress.get(key) ?? {};
      workspaceProgress.set(key, {
        ...existing,
        workspace: event.workspace ?? existing.workspace ?? '',
        workspaceDir: event.workspaceDir ?? existing.workspaceDir ?? '',
        workspaceIndex: event.workspaceIndex ?? existing.workspaceIndex ?? null,
        workspaceTotal: event.workspaceTotal ?? existing.workspaceTotal ?? null,
        lastStage: event.stage ?? existing.lastStage ?? '',
        message: event.message ?? existing.message ?? '',
        elapsedMs: event.elapsedMs ?? existing.elapsedMs ?? 0,
        updatedAt,
        debugLogFolders: event.debugLogFolders ?? existing.debugLogFolders ?? null,
        chatSnapshots: event.chatSnapshots ?? existing.chatSnapshots ?? null,
        hasMemoryRoot: event.hasMemoryRoot ?? existing.hasMemoryRoot ?? null,
        customizationInventory: event.customizationInventory ?? existing.customizationInventory ?? null,
        total: event.total ?? existing.total ?? null,
        index: event.index ?? existing.index ?? null,
        sessions: event.sessions ?? existing.sessions ?? null,
        memories: event.memories ?? existing.memories ?? null,
        customizations: event.customizations ?? existing.customizations ?? null,
        completed: event.stage === 'workspace-complete' || existing.completed === true,
      });
    }
    return event;
  }
}

function summarizeScanOptions(scanOptions = {}) {
  return {
    roots: Array.isArray(scanOptions.roots) ? scanOptions.roots.map(String) : [],
    customizationWorkspaceFolders: Array.isArray(scanOptions.customizationWorkspaceFolders)
      ? scanOptions.customizationWorkspaceFolders.map(String)
      : [],
    includeCustomizations: scanOptions.includeCustomizations !== false,
    sqlite: scanOptions.sqlite !== false,
  };
}

function scanResultMessage(mode, changedSessions, totalSessions) {
  if (mode === 'customizations') return 'Customization analysis complete';
  if (mode === 'full') return `Full rescan complete: ${totalSessions} sessions imported`;
  return changedSessions
    ? `${changedSessions} session${changedSessions === 1 ? '' : 's'} added or updated`
    : 'Copilot data is up to date';
}

function normalizeScanMode(mode) {
  return ['quick', 'full', 'customizations'].includes(String(mode)) ? String(mode) : 'quick';
}

function scanOptionsForMode(mode, baseScanOptions = {}, previousData = null) {
  if (mode === 'customizations') {
    const { customizationWorkspaceFolders, ...scanOptions } = baseScanOptions;
    if (mode === 'customizations' && Array.isArray(customizationWorkspaceFolders)) {
      return {
        ...scanOptions,
        includeCustomizations: true,
        requireWorkspaceFolders: true,
        workspaceFolders: customizationWorkspaceFolders,
        incrementalSince: previousData?.ingestion?.customizationEvidenceAnalyzedAt ?? '',
        customizationEvidence: {
          maxSessions: 0,
          maxModelCalls: 0,
          maxElapsedMs: 0,
          maxPartChars: 250_000,
          previousEvidence: previousData?.customizations ?? [],
          incrementalSince: previousData?.ingestion?.customizationEvidenceAnalyzedAt ?? '',
          ...(scanOptions.customizationEvidence ?? {}),
        },
      };
    }

    return {
      ...scanOptions,
      includeCustomizations: true,
      customizationEvidence: {
        maxSessions: 60,
        maxModelCalls: 500,
        maxElapsedMs: 90_000,
        maxPartChars: 250_000,
        ...(scanOptions.customizationEvidence ?? {}),
      },
    };
  }

  if (mode === 'full') {
    return {
      ...baseScanOptions,
      includeCustomizations: false,
      incrementalSince: '',
    };
  }

  return {
    ...baseScanOptions,
    includeCustomizations: false,
    incrementalSince: previousData?.generatedAt ?? '',
  };
}

function mergeIncrementalScan(previousData, deltaData) {
  const changedSessions = deltaData.sessions ?? [];
  const changedIds = new Set(changedSessions.map((session) => session.id));
  const sessions = [
    ...changedSessions,
    ...(previousData.sessions ?? []).filter((session) => !changedIds.has(session.id)),
  ]
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
  return preserveCustomizationSnapshot(previousData, {
    ...deltaData,
    ingestion: {
      ...deltaData.ingestion,
      importedSessions: sessions.length,
      ...sessionSourceCounts(sessions),
      incrementalSessionsImported: changedSessions.length,
    },
    sessions,
  });
}

function mergeCustomizationScan(previousData, currentWorkspaceData) {
  const scannedWorkspaces = new Set(
    (currentWorkspaceData.ingestion?.workspaceScans ?? [])
      .map((scan) => scan.workspace)
      .filter(Boolean),
  );
  const sessionsById = new Map((previousData.sessions ?? []).map((session) => [session.id, session]));
  for (const session of currentWorkspaceData.sessions ?? []) {
    sessionsById.set(session.id, session);
  }
  const memoriesById = new Map((previousData.memories ?? []).map((memory) => [memory.id, memory]));
  for (const memory of currentWorkspaceData.memories ?? []) {
    memoriesById.set(memory.id, memory);
  }
  const retainedCustomizations = (previousData.customizations ?? []).filter(
    (customization) => !scannedWorkspaces.has(customization.workspace),
  );
  const customizationsById = new Map(retainedCustomizations.map((customization) => [customization.id, customization]));
  for (const customization of currentWorkspaceData.customizations ?? []) {
    customizationsById.set(customization.id, customization);
  }
  const sessions = [...sessionsById.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const memories = [...memoriesById.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const customizations = [...customizationsById.values()].sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt),
  );

  return {
    ...previousData,
    generatedAt: currentWorkspaceData.generatedAt,
    ingestion: {
      ...previousData.ingestion,
      ...currentWorkspaceData.ingestion,
      importedSessions: sessions.length,
      ...sessionSourceCounts(sessions),
      importedCustomizations: customizations.length,
    },
    sessions,
    memories,
    customizations,
  };
}

function sessionSourceCounts(sessions) {
  return {
    importedDebugLogSessions: sessions.filter(
      (session) => session.sourceKind === 'vscode-copilot-debug-log',
    ).length,
    importedChatSnapshotSessions: sessions.filter(
      (session) => session.sourceKind === 'vscode-chat-session-snapshot',
    ).length,
  };
}

function preserveCustomizationSnapshot(previousData, nextData) {
  const hasPreviousCustomizations = Array.isArray(previousData.customizations) && previousData.customizations.length > 0;
  const nextHasCustomizations = Array.isArray(nextData.customizations) && nextData.customizations.length > 0;
  if (!hasPreviousCustomizations || nextHasCustomizations) {
    return nextData;
  }

  return {
    ...nextData,
    ingestion: {
      ...nextData.ingestion,
      scannedCustomizationLocations:
        nextData.ingestion?.scannedCustomizationLocations ??
        previousData.ingestion?.scannedCustomizationLocations,
      importedCustomizations:
        nextData.ingestion?.importedCustomizations ??
        previousData.ingestion?.importedCustomizations,
      customizationEvidenceScannedSessions:
        nextData.ingestion?.customizationEvidenceScannedSessions ??
        previousData.ingestion?.customizationEvidenceScannedSessions,
      customizationEvidenceAnalyzedAt:
        nextData.ingestion?.customizationEvidenceAnalyzedAt ||
        previousData.ingestion?.customizationEvidenceAnalyzedAt,
      customizationEvidenceModelCalls:
        nextData.ingestion?.customizationEvidenceModelCalls ??
        previousData.ingestion?.customizationEvidenceModelCalls,
      customizationEvidenceTextParts:
        nextData.ingestion?.customizationEvidenceTextParts ??
        previousData.ingestion?.customizationEvidenceTextParts,
      customizationEvidenceMatchedCustomizations:
        nextData.ingestion?.customizationEvidenceMatchedCustomizations ??
        previousData.ingestion?.customizationEvidenceMatchedCustomizations,
    },
    customizations: previousData.customizations,
  };
}

function waitForActiveScanOrTimeout(activeScan, timeoutMs) {
  if (!timeoutMs) {
    return Promise.resolve();
  }

  return Promise.race([
    activeScan,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs)),
  ]);
}

function isScanStoppedError(error) {
  return /scan stopped by user/i.test(error instanceof Error ? error.message : String(error));
}

function scanInChildProcess(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const signal = options.signal;
  const scanOptions = { ...options };
  delete scanOptions.onProgress;
  delete scanOptions.signal;

  return new Promise((resolveScan, rejectScan) => {
    const child = fork(scannerWorkerPath, {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    let settled = false;
    let stderr = '';

    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      rejectScan(new Error('Scan stopped by user.'));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener?.('abort', abort, { once: true });

    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8000);
    });

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'progress') {
        onProgress(message.event ?? {});
        return;
      }
      if (message.type === 'result') {
        settled = true;
        signal?.removeEventListener?.('abort', abort);
        resolveScan(message.sessionData);
        child.kill();
        return;
      }
      if (message.type === 'error') {
        settled = true;
        signal?.removeEventListener?.('abort', abort);
        const error = new Error(message.error?.message ?? 'Scanner worker failed.');
        error.stack = message.error?.stack || error.stack;
        rejectScan(error);
        child.kill();
      }
    });

    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener?.('abort', abort);
        rejectScan(error);
      }
    });

    child.once('exit', (code, exitSignal) => {
      if (!settled) {
        settled = true;
        options.signal?.removeEventListener?.('abort', abort);
        rejectScan(
          new Error(
            `Scanner worker exited before returning data (${exitSignal ?? `code ${code}`}).${stderr ? `\n${stderr}` : ''}`,
          ),
        );
      }
    });

    child.send({ type: 'scan', options: scanOptions });
  });
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        rejectBody(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', rejectBody);
  });
}

function openLocalPath(path, action) {
  const target = resolve(path);
  let command;
  let args;

  if (process.platform === 'win32') {
    command = 'explorer.exe';
    args = action === 'reveal' ? ['/select,', target] : [target];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = action === 'reveal' ? ['-R', target] : [target];
  } else {
    command = 'xdg-open';
    args = [action === 'reveal' ? dirname(target) : target];
  }

  return new Promise((resolveOpen, rejectOpen) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', rejectOpen);
    child.once('spawn', () => {
      child.unref();
      resolveOpen();
    });
  });
}

function readCachedSessionData(dataFile, logger) {
  if (!existsSync(dataFile)) {
    return null;
  }

  try {
    const value = JSON.parse(readFileSync(dataFile, 'utf8'));
    return value && Array.isArray(value.sessions) ? value : null;
  } catch (error) {
    logger.warn(`Ignoring unreadable cached session data at ${dataFile}: ${error.message}`);
    return null;
  }
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    ...corsHeaders(),
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(payload);
}

function corsHeaders() {
  return {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'access-control-max-age': '600',
  };
}

function serveStaticFile(request, response, staticDir, pathname) {
  if (!existsSync(staticDir)) {
    return sendJson(response, 404, {
      error: 'The production UI has not been built. Run npm run build first.',
    });
  }

  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let file = safeStaticPath(staticDir, relativePath);

  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    file = safeStaticPath(staticDir, 'index.html');
  }

  if (!file || !existsSync(file)) {
    return sendJson(response, 404, { error: 'UI file not found.' });
  }

  const headers = {
    'content-type': contentTypes.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
  };
  if (file.endsWith('index.html')) {
    headers['cache-control'] = 'no-store';
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function safeStaticPath(staticDir, relativePath) {
  const root = `${resolve(staticDir)}${sep}`;
  const candidate = resolve(join(staticDir, normalize(relativePath)));
  return candidate.startsWith(root) ? candidate : null;
}
