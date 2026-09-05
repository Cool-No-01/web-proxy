// src/server.js
//
// Phase 1: HTTP Proxy Core の起動点。
// Node標準の http server で受け、Web標準 Request/Response に変換して ProxyCore に渡す。
// (ProxyCore/network層はWeb標準fetch APIベースで書いているため、ここで橋渡しする)

import http from 'node:http';
import { Readable } from 'node:stream';
import { MemorySessionStore } from './session/store.js';
import { SessionManager } from './session/manager.js';
import { Pipeline } from './core/pipeline.js';
import { ProxyCore } from './core/proxy.js';

const PORT = process.env.PORT || 8080;
const SESSION_COOKIE_NAME = 'gw_session';

const sessionStore = new MemorySessionStore({ ttlMs: 30 * 60 * 1000 });
const sessionManager = new SessionManager(sessionStore);
const pipeline = new Pipeline();
const proxyCore = new ProxyCore({ sessionManager });

const stats = {
  activeConnections: 0,
  totalRequests: 0,
  errors: 0,
  startedAt: Date.now(),
};

function getIncomingSessionId(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function nodeReqToWebRequest(req) {
  const url = `http://${req.headers.host}${req.url}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

async function sendWebResponse(webResponse, res, sessionId, isNewSession) {
  const headers = {};
  for (const [key, value] of webResponse.headers.entries()) headers[key] = value;

  if (isNewSession) {
    headers['set-cookie'] = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
  }

  res.writeHead(webResponse.status, headers);

  if (!webResponse.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(webResponse.body);
  nodeStream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  stats.activeConnections += 1;
  stats.totalRequests += 1;

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (parsedUrl.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (parsedUrl.pathname === '/api/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ...stats,
        ...sessionStore.stats(),
        uptimeMs: Date.now() - stats.startedAt,
      }));
      return;
    }

    if (parsedUrl.pathname !== '/proxy') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found. Use /proxy?url=...');
      return;
    }

    const incomingSessionId = getIncomingSessionId(req);
    const sessionId = await sessionManager.getOrCreate(incomingSessionId);
    const isNewSession = sessionId !== incomingSessionId;

    const webReq = nodeReqToWebRequest(req);
    const targetUrlParam = parsedUrl.searchParams.get('url');

    const ctx = { webReq, sessionId, targetUrlParam };
    await pipeline.runBefore(ctx);

    const webRes = await proxyCore.handle(webReq, sessionId, targetUrlParam);

    await pipeline.runAfter(ctx);
    await sendWebResponse(webRes, res, sessionId, isNewSession);
  } catch (err) {
    stats.errors += 1;
    console.error('[gateway] request failed:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad gateway');
    } else {
      res.end();
    }
  } finally {
    stats.activeConnections -= 1;
  }
});

// Graceful shutdown (Phase 19: Railway最適化の一部を先取り)
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gateway] received ${signal}, closing server...`);
  server.close(() => {
    sessionStore.close();
    console.log('[gateway] closed gracefully.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`[gateway] Phase 1 HTTP Proxy Core listening on :${PORT}`);
});
