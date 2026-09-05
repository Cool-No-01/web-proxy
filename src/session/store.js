// src/session/store.js
//
// SessionStore の抽象インターフェースと、MemorySessionStore実装。
// 将来 FileSessionStore / RedisSessionStore に差し替え可能な形にしている。

export class SessionStore {
  async get(sessionId) { throw new Error('not implemented'); }
  async set(sessionId, data) { throw new Error('not implemented'); }
  async delete(sessionId) { throw new Error('not implemented'); }
  async touch(sessionId) { throw new Error('not implemented'); }
}

export class MemorySessionStore extends SessionStore {
  constructor({ ttlMs = 30 * 60 * 1000, sweepIntervalMs = 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.map = new Map(); // sessionId -> { data, lastAccess }
    this._sweep = setInterval(() => this._evictExpired(), sweepIntervalMs);
    this._sweep.unref?.();
  }

  async get(sessionId) {
    const entry = this.map.get(sessionId);
    if (!entry) return null;
    if (Date.now() - entry.lastAccess > this.ttlMs) {
      this.map.delete(sessionId);
      return null;
    }
    return entry.data;
  }

  async set(sessionId, data) {
    this.map.set(sessionId, { data, lastAccess: Date.now() });
  }

  async touch(sessionId) {
    const entry = this.map.get(sessionId);
    if (entry) entry.lastAccess = Date.now();
  }

  async delete(sessionId) {
    this.map.delete(sessionId);
  }

  _evictExpired() {
    const now = Date.now();
    for (const [id, entry] of this.map) {
      if (now - entry.lastAccess > this.ttlMs) this.map.delete(id);
    }
  }

  stats() {
    return { activeSessions: this.map.size };
  }

  close() {
    clearInterval(this._sweep);
  }
}
