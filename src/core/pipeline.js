// src/core/pipeline.js
//
// Request -> Middleware(前段) -> Proxy Core -> Middleware(後段) -> Response
// というパイプラインの最小実装。Phase 1では通すだけの薄い実装。

export class Pipeline {
  constructor() {
    this.before = []; // (ctx) => void|Promise<void>  例外を投げれば中断
    this.after = [];  // (ctx) => void|Promise<void>
  }

  use({ before, after } = {}) {
    if (before) this.before.push(before);
    if (after) this.after.push(after);
    return this;
  }

  async runBefore(ctx) {
    for (const fn of this.before) await fn(ctx);
  }

  async runAfter(ctx) {
    for (const fn of this.after) await fn(ctx);
  }
}
