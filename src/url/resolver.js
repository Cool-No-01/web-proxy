// src/url/resolver.js
//
// Proxy URL <-> Target URL の変換を一元管理する。
// SSRF対策の「最低限」はここに組み込む(private/loopback/link-localへのアクセス拒否)。
// より詳細なポリシー(ドメインallowlist等)は middleware/security.js 側で拡張する想定。

import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * "/proxy?url=..." のクエリからターゲットURLを取り出し、正規化する。
 * 相対URL(./a, ../a, //cdn.example.com/a.js など)は baseUrl を基準に解決する。
 */
export function resolveTargetUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  try {
    const resolved = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null; // file:, javascript: などは拒否
    }
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Target URL を Proxy 経由のURLに変換する。
 * 例: https://example.com/a/b -> /proxy?url=https%3A%2F%2Fexample.com%2Fa%2Fb
 */
export function toProxyUrl(targetUrl, gatewayOrigin) {
  const u = new URL(String(targetUrl));
  return `${gatewayOrigin}/proxy?url=${encodeURIComponent(u.toString())}`;
}

const PRIVATE_V4_RANGES = [
  ['0.0.0.0', '0.255.255.255'],
  ['10.0.0.0', '10.255.255.255'],
  ['100.64.0.0', '100.127.255.255'], // CGNAT
  ['127.0.0.0', '127.255.255.255'],
  ['169.254.0.0', '169.254.255.255'], // link-local / cloud metadata
  ['172.16.0.0', '172.31.255.255'],
  ['192.0.0.0', '192.0.0.255'],
  ['192.168.0.0', '192.168.255.255'],
  ['198.18.0.0', '198.19.255.255'],
];

function ipToLong(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

function isPrivateV4(ip) {
  const n = ipToLong(ip);
  return PRIVATE_V4_RANGES.some(([start, end]) => n >= ipToLong(start) && n <= ipToLong(end));
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') || // unique local
    lower.startsWith('fe80') // link-local
  );
}

/**
 * ホスト名を解決し、private/loopback/link-local IPを指していないか検証する。
 * SSRF対策の最低ラインとして、Proxy Core内で必ず呼び出す。
 * DNS Rebinding対策のため、fetch直前に呼び、解決したIPへ直接接続する運用を推奨(Phase 7以降で強化)。
 */
export async function assertSafeTarget(targetUrl) {
  const hostname = targetUrl.hostname;

  // hostnameそのものがIPリテラルの場合
  if (net.isIP(hostname)) {
    if (net.isIP(hostname) === 4 && isPrivateV4(hostname)) {
      throw new SsrfBlockedError(hostname);
    }
    if (net.isIP(hostname) === 6 && isPrivateV6(hostname)) {
      throw new SsrfBlockedError(hostname);
    }
    return;
  }

  if (hostname === 'localhost') {
    throw new SsrfBlockedError(hostname);
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    // 名前解決できない場合はそのままHTTPクライアント側で失敗させる
    return;
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateV4(address)) throw new SsrfBlockedError(hostname, address);
    if (family === 6 && isPrivateV6(address)) throw new SsrfBlockedError(hostname, address);
  }
}

export class SsrfBlockedError extends Error {
  constructor(hostname, address) {
    super(`Blocked target: ${hostname}${address ? ` (${address})` : ''} resolves to a private/internal address`);
    this.name = 'SsrfBlockedError';
    this.hostname = hostname;
    this.address = address;
  }
}
