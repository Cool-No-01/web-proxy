# web-browser-gateway (Phase 1: HTTP Proxy Core)

Chromium/Playwrightのようなブラウザエンジンをサーバー上で起動せず、
HTTP/Cookie/Redirect/Header周りを高度に処理することで
「普通のブラウザでサイトを開いている」状態に近づけることを目指す
Browser Compatibility Gatewayです。

このREADMEはPhase 1(HTTP Proxy Core + Session/Cookie/Redirectの骨格)時点のものです。
以降のPhase(HTML/CSS Rewrite, WebSocket/SSE, Cache, Dashboard等)は
この骨格の上にモジュールを追加していく形で実装します。

## セキュリティに関する重要事項

このPhase 1から、`src/url/resolver.js` の `assertSafeTarget()` により
**プライベートIP・ループバック・リンクローカルアドレス(クラウドのメタデータエンドポイント含む)への
アクセスを拒否**しています。これはSSRF(Server-Side Request Forgery)対策の最低ラインです。

任意のURLを外部から受け取ってサーバー側でfetchするアーキテクチャ上、この対策なしに
本番相当の環境(Railway含む)へデプロイすることは強く非推奨です。
より厳密なポリシー(ドメインallowlist、レート制限、認証必須化など)は
`src/middleware/security.js`(Phase 7以降で実装予定)側で追加してください。

## リクエストの流れ

```
Client
  │  GET /proxy?url=https://example.com/
  ▼
server.js
  │  ・Node標準 http.IncomingMessage を Web標準 Request に変換
  │  ・Cookieヘッダーから gw_session を読み取り、無ければ新規発行
  ▼
ProxyCore.handle()
  │  ・URL Resolver: url= パラメータを検証・正規化
  │  ・assertSafeTarget(): private/loopback IPへのアクセスを拒否 (SSRF対策)
  │  ・CookieJar: セッションに紐づくCookieをリクエストヘッダーに付与
  │  ・network/http.js: hop-by-hopヘッダーを除いてターゲットへfetch()
  │  ・Redirect Engine: 30xを検出したらサーバー内部で追従(最大5回)
  │  ・レスポンスのSet-CookieをCookieJarに取り込む
  ▼
network/http.js (targetへのリクエスト)
  ▼
Target Web
  │
  ▼ (Response, body: ReadableStream)
ProxyCore
  │  ・Set-Cookieはクライアントへ渡さず、サーバー側のJarで管理
  ▼
server.js
  │  ・Web標準 Response を Node標準 http.ServerResponse に変換
  │  ・body(ReadableStream)はバッファせずそのままpipeでstreaming
  ▼
Client
```

ポイントは、リクエストボディもレスポンスボディも **一度もRAMに全体を溜め込まず**、
Node.jsのstreamとWeb標準ReadableStreamの変換だけで転送していることです。
これにより巨大な動画・画像・ファイルでもメモリを圧迫しません。

## Cookie / Session の管理

```
User A ── sessionId (Cookie: gw_session) ── CookieJar A ── { example.com: [...], cdn.example.com: [...] }
User B ── sessionId (Cookie: gw_session) ── CookieJar B ── { ... }
```

- `session/manager.js` が `sessionId -> CookieJar` の対応を管理します。
- `session/store.js` の `MemorySessionStore` がセッションのメタデータ(作成時刻・最終アクセス時刻)を
  TTL付きで保持し、アイドルセッションは定期的に自動破棄されます。
- `SessionStore` は抽象クラスなので、将来 `RedisSessionStore` 等に差し替え可能です。
- `session/cookie-jar.js` はDomain/Path/Secure/HttpOnly/SameSite/Expires/Max-Ageを保持し、
  ホストとパスが一致するCookieだけをリクエストヘッダーに組み立てます。

Cookieはクライアントの目には見えません。ブラウザが受け取るのは `gw_session` という
1本のセッションCookieだけで、対象サイトのCookieはすべてサーバー側のJarで管理されます。

## HTML Rewriteについて(Phase 1では未実装)

Phase 1はHTML/CSSの中身を一切書き換えず、透過的にstreamingするだけです。
そのため現時点では、相対パスで書かれたリンクや `fetch()` 呼び出しは
Proxy経由に変換されず、ブラウザから直接ターゲットサイトへ飛んでしまいます。
Phase 4(HTML Rewrite Engine)・Phase 5(CSS Rewrite Engine)・Phase 8(JS Compatibility Layer)で
この部分を段階的に実装していきます。

## Railway上でのCPU/RAM節約(Phase 1時点)

- レスポンスは `ReadableStream` のまま `pipe()` しており、ボディ全体をバッファしていません。
- セッションは `MemorySessionStore` のTTL(既定30分)で自動的に破棄され、無限に増えません。
- Dockerイメージは `node:20-alpine` ベースで、依存ライブラリを追加していません
  (Node.js標準の `fetch`/`Headers`/`Request`/`Response`/streamのみ使用)。
- `SIGTERM` を受け取ると新規リクエストの受付を止め、既存接続の処理完了を待ってから終了します
  (Railwayのデプロイ時の再起動でコネクションを強制切断しないため)。

## 起動方法

```bash
npm install
npm start
# http://localhost:8080/proxy?url=https://example.com/ にアクセス
```

## エンドポイント(Phase 1時点)

| Path | 説明 |
|---|---|
| `GET /proxy?url=<encoded target url>` | 対象URLへプロキシ転送 |
| `GET /api/health` | ヘルスチェック |
| `GET /api/stats` | 簡易統計(アクティブセッション数、リクエスト数、エラー数など) |

## 次のPhase

- Phase 3: Redirect Engine強化 / Header Engineの独立モジュール化
- Phase 4-5: HTML/CSS Rewrite Engine (parserベースでのURL書き換え)
- Phase 6: WebSocket / SSE Engine
- Phase 7: Cache / Compression / Connection Pool + `middleware/security.js`(SSRFポリシー強化、allowlist)
- Phase 8: JS Compatibility Layer(Compatibility Script注入)
- Phase 9: Metrics / Dashboard
