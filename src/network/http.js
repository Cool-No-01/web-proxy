// src/network/http.js
//
// ターゲットへのHTTPリクエストを、Node18+ の fetch (undici) を使って行う。
// レスポンスbodyはReadableStreamのまま返し、呼び出し側でstreamingできるようにする。
// (= 巨大なレスポンスをRAMにため込まない)

// Node.js fetch/HeadersはそのままRequest/Response headerを保持できる。
// hop-by-hopヘッダーはHeader Engine相当としてここでまとめて除外する。
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host', // 送信時に自前で付け直す
]);

export function filterHopByHopHeaders(headers) {
  const out = new Headers();
  for (const [key, value] of headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  }
  return out;
}

/**
 * targetUrl に対してストリーミングでリクエストを送る。
 * @param {URL} targetUrl
 * @param {object} opts { method, headers(Headers), body(ReadableStream|null), signal }
 * @returns {Promise<Response>} fetchのResponse(body: ReadableStream)
 */
export async function forwardRequest(targetUrl, { method, headers, body, signal }) {
  const outHeaders = filterHopByHopHeaders(headers);
  outHeaders.set('host', targetUrl.host);

  const init = {
    method,
    headers: outHeaders,
    redirect: 'manual', // Redirect EngineでLocationを制御するため自動追従しない
    signal,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = body;
    init.duplex = 'half'; // streaming bodyを送る場合Node fetchで必要
  }

  return fetch(targetUrl, init);
}
