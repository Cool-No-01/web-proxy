// src/session/cookie-jar.js
//
// ユーザー(セッション)ごとに独立したCookie Jar。
// Set-Cookieのパース、Domain/Path/Secure/HttpOnly/SameSite/Expires/Max-Ageの保持、
// リクエスト時のCookieヘッダー組み立てを担当する。

function parseSetCookie(headerValue) {
  const parts = headerValue.split(';').map((p) => p.trim());
  const [nameValue, ...attrParts] = parts;
  const eqIdx = nameValue.indexOf('=');
  if (eqIdx === -1) return null;

  const name = nameValue.slice(0, eqIdx).trim();
  const value = nameValue.slice(eqIdx + 1).trim();

  const cookie = {
    name,
    value,
    domain: null,
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    expires: null, // epoch ms, nullなら session cookie
    hostOnly: true,
  };

  for (const attr of attrParts) {
    const [rawKey, rawVal] = attr.split('=').map((s) => s?.trim());
    const key = rawKey.toLowerCase();
    switch (key) {
      case 'domain':
        if (rawVal) {
          cookie.domain = rawVal.replace(/^\./, '').toLowerCase();
          cookie.hostOnly = false;
        }
        break;
      case 'path':
        if (rawVal) cookie.path = rawVal;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite':
        if (rawVal) cookie.sameSite = rawVal;
        break;
      case 'max-age': {
        const seconds = parseInt(rawVal, 10);
        if (!Number.isNaN(seconds)) cookie.expires = Date.now() + seconds * 1000;
        break;
      }
      case 'expires': {
        const t = Date.parse(rawVal);
        if (!Number.isNaN(t) && cookie.expires === null) cookie.expires = t;
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}

export class CookieJar {
  constructor() {
    // key: `${domain}|${path}|${name}` -> cookie object
    this.store = new Map();
  }

  setFromResponseHeader(headerValue, requestHost) {
    const cookie = parseSetCookie(headerValue);
    if (!cookie) return;
    if (!cookie.domain) cookie.domain = requestHost.toLowerCase();
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    this.store.set(key, cookie);
  }

  _isExpired(cookie) {
    return cookie.expires !== null && cookie.expires <= Date.now();
  }

  _domainMatches(cookieDomain, hostOnly, requestHost) {
    const host = requestHost.toLowerCase();
    if (hostOnly) return host === cookieDomain;
    return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
  }

  _pathMatches(cookiePath, requestPath) {
    if (requestPath === cookiePath) return true;
    if (requestPath.startsWith(cookiePath)) {
      return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
    }
    return false;
  }

  getCookieHeader(requestHost, requestPath, isSecure) {
    const matches = [];
    for (const [key, cookie] of this.store) {
      if (this._isExpired(cookie)) {
        this.store.delete(key);
        continue;
      }
      if (cookie.secure && !isSecure) continue;
      if (!this._domainMatches(cookie.domain, cookie.hostOnly, requestHost)) continue;
      if (!this._pathMatches(cookie.path, requestPath)) continue;
      matches.push(`${cookie.name}=${cookie.value}`);
    }
    return matches.join('; ');
  }

  clear() {
    this.store.clear();
  }
}
