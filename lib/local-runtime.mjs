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
  let scanProgress = null;

  let sessionData = readCachedSessionData(dataFile, logger)
    ?? (seedDataFile ? readCachedSessionData(seedDataFile, logger) : null);
  let phase = sessionData ? 'ready' : 'empty';
  let lastError = '';
  let lastScanStartedAt = '';
  let lastScanCompletedAt = '';
  let lastScanDurationMs = 0;
  let activeScan = null;
  let activeScanId = 0;
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
      scanProgress,
      logFile,
      recentLogs: logEntries.slice(-12),
    };
  }

  function refresh(reason = 'manual') {
    if (activeScan) {
      emitLog('log', `Scan already running; reusing active ${reason} request.`);
      return activeScan;
    }

    const started = Date.now();
    const scanId = ++scanSequence;
    activeScanId = scanId;
    lastScanStartedAt = new Date(started).toISOString();
    lastError = '';
    phase = 'scanning';
    scanProgress = {
      stage: 'starting',
      message: `Starting scan #${scanId} (${reason}).`,
      scanId,
      reason,
      updatedAt: lastScanStartedAt,
    };
    emitLog('log', `Starting local data refresh #${scanId} (${reason}).`);

    activeScan = Promise.resolve()
      .then(() =>
        scanner({
          ...scanOptions,
          onProgress: (progress) => {
            scanProgress = {
              ...progress,
              scanId,
              reason,
              updatedAt: new Date().toISOString(),
            };
            if (progress?.message) {
              emitLog('log', progress.message);
            }
          },
        }),
      )
      .then((nextSessionData) => {
        writer(nextSessionData, dataFile);
        sessionData = nextSessionData;
        phase = 'ready';
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        scanProgress = {
          stage: 'complete',
          message: `Scan #${scanId} imported ${nextSessionData.sessions.length} sessions.`,
          scanId,
          reason,
          updatedAt: lastScanCompletedAt,
        };
        emitLog(
          'log',
          `Local data refresh #${scanId} (${reason}) imported ${nextSessionData.sessions.length} sessions in ${lastScanDurationMs}ms.`,
        );
        return nextSessionData;
      })
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error);
        phase = sessionData ? 'ready' : 'error';
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        scanProgress = {
          stage: 'failed',
          message: lastError,
          scanId,
          reason,
          updatedAt: lastScanCompletedAt,
        };
        emitLog('error', `Local data refresh #${scanId} (${reason}) failed: ${lastError}`);
        if (error instanceof Error && error.stack) {
          emitLog('error', error.stack);
        }
        throw error;
      })
      .finally(() => {
        activeScan = null;
        activeScanId = 0;
      });

    return activeScan;
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
          const nextSessionData = await refresh('manual');
          return sendJson(response, 200, { sessionData: nextSessionData, status: status() });
        } catch {
          return sendJson(response, 500, { error: lastError, status: status() });
        }
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
          void refresh('startup').catch(() => {});
        }
      });
    }),
    refresh,
    status,
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

function scanInChildProcess(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const scanOptions = { ...options };
  delete scanOptions.onProgress;

  return new Promise((resolveScan, rejectScan) => {
    const child = fork(scannerWorkerPath, {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    let settled = false;
    let stderr = '';

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
        resolveScan(message.sessionData);
        child.kill();
        return;
      }
      if (message.type === 'error') {
        settled = true;
        const error = new Error(message.error?.message ?? 'Scanner worker failed.');
        error.stack = message.error?.stack || error.stack;
        rejectScan(error);
        child.kill();
      }
    });

    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        rejectScan(error);
      }
    });

    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        rejectScan(
          new Error(
            `Scanner worker exited before returning data (${signal ?? `code ${code}`}).${stderr ? `\n${stderr}` : ''}`,
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
