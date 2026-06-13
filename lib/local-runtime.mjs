import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { scanVsCodeSessions, writeSessionData } from './scanner-api.mjs';

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

export function createLocalRuntime(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = Number(options.port ?? 4312);
  const dataFile = resolve(options.dataFile ?? 'tmp/local-runtime/sessions.json');
  const seedDataFile = options.seedDataFile === null
    ? null
    : resolve(options.seedDataFile ?? 'public/data/sessions.json');
  const staticDir = resolve(options.staticDir ?? 'dist/copilot-usage-studio/browser');
  const scanOptions = options.scanOptions ?? {};
  const scanner = options.scanner ?? scanVsCodeSessions;
  const writer = options.writer ?? writeSessionData;
  const logger = options.logger ?? console;

  let sessionData = readCachedSessionData(dataFile, logger)
    ?? (seedDataFile ? readCachedSessionData(seedDataFile, logger) : null);
  let phase = sessionData ? 'ready' : 'empty';
  let lastError = '';
  let lastScanStartedAt = '';
  let lastScanCompletedAt = '';
  let lastScanDurationMs = 0;
  let activeScan = null;

  function status() {
    return {
      phase,
      scanning: Boolean(activeScan),
      hasData: Boolean(sessionData),
      sessionCount: sessionData?.sessions?.length ?? 0,
      generatedAt: sessionData?.generatedAt ?? '',
      lastScanStartedAt,
      lastScanCompletedAt,
      lastScanDurationMs,
      lastError,
    };
  }

  function refresh(reason = 'manual') {
    if (activeScan) {
      return activeScan;
    }

    const started = Date.now();
    lastScanStartedAt = new Date(started).toISOString();
    lastError = '';
    phase = 'scanning';

    activeScan = Promise.resolve()
      .then(() => scanner(scanOptions))
      .then((nextSessionData) => {
        writer(nextSessionData, dataFile);
        sessionData = nextSessionData;
        phase = 'ready';
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        logger.log(
          `Local data refresh (${reason}) imported ${nextSessionData.sessions.length} sessions in ${lastScanDurationMs}ms.`,
        );
        return nextSessionData;
      })
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error);
        phase = sessionData ? 'ready' : 'error';
        lastScanCompletedAt = new Date().toISOString();
        lastScanDurationMs = Date.now() - started;
        logger.error(`Local data refresh failed: ${lastError}`);
        throw error;
      })
      .finally(() => {
        activeScan = null;
      });

    return activeScan;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

      if (request.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(response, 200, status());
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

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { error: 'Method not allowed.' });
      }

      return serveStaticFile(request, response, staticDir, url.pathname);
    } catch (error) {
      logger.error(error);
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
        logger.log(`Copilot Usage Studio local runtime: http://${host}:${address.port}/`);
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
        await activeScan;
      } catch {
        // The response below reports the retained empty/error state.
      }
    }
  }
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
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(payload);
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
