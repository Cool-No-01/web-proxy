// src/core/proxy.js
//
// Proxy Core: Session Engine / URL Resolver / Header Engine(簡易) / Network Client を束ね、
// streamingでレスポンスを返す。Phase 1ではHTML/CSS書き換えは行わず、透過転送する。

import { resolveTargetUrl, assertSafeTarget, SsrfBlockedError } from '../url/resolver.js';
import { forwardRequest } from '../network/http.js';

const MAX_REDIRECTS = 5;

export class ProxyCore {
  constructor({ sessionManager }) {
    this.sessionManager = sessionManager;
  }

  /**
   * @param {Request} req - Node18+ の Web標準 Request (Fetchベース) を想定
   * @param {string} sessionId
   * @param {string} rawTargetUrl - ?url= で渡された値
   */
  async handle(req, sessionId, rawTargetUrl) {
    let targetUrl = resolveTargetUrl(rawTargetUrl);
    if (!targetUrl) {
      return textResponse(400, 'invalid or missing url parameter');
    }

    const jar = this.sessionManager.getCookieJar(sessionId);
    let redirectCount = 0;

    while (true) {
      try {
        await assertSafeTarget(targetUrl);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          return textResponse(403, `Blocked: target resolves to a private/internal address`);
        }
        throw err;
      }

      const outHeaders = new Headers(req.headers);
      outHeaders.delete('cookie');
      const cookieHeader = jar.getCookieHeader(targetUrl.hostname, targetUrl.pathname, targetUrl.protocol === 'https:');
      if (cookieHeader) outHeaders.set('cookie', cookieHeader);
      outHeaders.set('origin', targetUrl.origin);
      outHeaders.set('referer', targetUrl.origin + '/');

      const targetResponse = await forwardRequest(targetUrl, {
        method: req.method,
        headers: outHeaders,
        body: req.body,
        signal: req.signal,
      });

      // Set-Cookie を Cookie Jar に取り込む(複数ある場合に対応)
      const setCookies = typeof targetResponse.headers.getSetCookie === 'function'
        ? targetResponse.headers.getSetCookie()
        : [];
      for (const sc of setCookies) jar.setFromResponseHeader(sc, targetUrl.hostname);

      // Redirect Engine (簡易): 30x を検出したら追従するかどうかここで判断
      if ([301, 302, 303, 307, 308].includes(targetResponse.status)) {
        const location = targetResponse.headers.get('location');
        if (location && redirectCount < MAX_REDIRECTS) {
          const nextUrl = resolveTargetUrl(location, targetUrl.toString());
          if (nextUrl) {
            targetUrl = nextUrl;
            redirectCount += 1;
            continue; // クライアントには見せず、Proxy内部で追従
          }
        }
      }

      return buildClientResponse(targetResponse);
    }
  }
}

function buildClientResponse(targetResponse) {
  const headers = new Headers(targetResponse.headers);
  headers.delete('set-cookie'); // Phase 1: Proxy側で管理するためクライアントには渡さない
  headers.delete('content-security-policy'); // 後続phaseのRewrite Engineで書き換え可能にする前提の暫定処置
  headers.delete('content-security-policy-report-only');

  // targetResponse.body は ReadableStream。そのままstreamingで返す。
  return new Response(targetResponse.body, {
    status: targetResponse.status,
    statusText: targetResponse.statusText,
    headers,
  });
}

function textResponse(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
