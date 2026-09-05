// src/session/manager.js
//
// SessionEngine: sessionId <-> { CookieJar, metadata } を管理する。
// 永続化方式は SessionStore に委譲(現状 MemorySessionStore)。

import crypto from 'node:crypto';
import { CookieJar } from './cookie-jar.js';

export class SessionManager {
  constructor(store) {
    this.store = store;
    this.jars = new Map(); // sessionId -> CookieJar (プロセス内キャッシュ)
  }

  createSession() {
    const sessionId = crypto.randomUUID();
    this.jars.set(sessionId, new CookieJar());
    this.store.set(sessionId, {
      createdAt: Date.now(),
      lastAccess: Date.now(),
      metadata: {},
    });
    return sessionId;
  }

  async getOrCreate(sessionId) {
    if (sessionId) {
      const existing = await this.store.get(sessionId);
      if (existing) {
        await this.store.touch(sessionId);
        if (!this.jars.has(sessionId)) this.jars.set(sessionId, new CookieJar());
        return sessionId;
      }
    }
    return this.createSession();
  }

  getCookieJar(sessionId) {
    let jar = this.jars.get(sessionId);
    if (!jar) {
      jar = new CookieJar();
      this.jars.set(sessionId, jar);
    }
    return jar;
  }

  async destroy(sessionId) {
    this.jars.delete(sessionId);
    await this.store.delete(sessionId);
  }
}
