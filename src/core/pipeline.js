// src/core/pipeline.js
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const urlModule = require('url');
const fs = require('fs');
const path = require('path');

class Pipeline {
  constructor(config) {
    this.config = config;
    this.sessions = {};
    this.server = null;
    this.isRunning = false;
    this.version = '1.0.0-railway-pro';
    this.startTime = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
    this.rateLimit = new Map();
    this.activeConnections = 0;
  }

  async start() {
    this.isRunning = true;
    this.server = http.createServer({ keepAlive: true, keepAliveTimeout: 60000 }, this.handleRequest.bind(this));
    this.server.listen(this.config.port, () => {
      console.log(`🚀 ProXYRail v${this.version} running on :${this.config.port}`);
      console.log(`💨 Uptime: ${(Date.now() - this.startTime)/1000}s | Active: ${this.activeConnections}`);
    });
    console.log(`✅ Proxy ready - Domain: ${this.config.domain || 'any'} | Env: ${process.env.PORT}`);
    this.startMonitoring();
  }

  startMonitoring() {
    setInterval(() => {
      if (this.isRunning) {
        console.log(`📊 QPS: ${this.requestCount} | Errors: ${this.errorCount} | Connections: ${this.activeConnections}`);
        this.requestCount = 0;
        this.errorCount = 0;
      }
    }, 5000);
  }

  async handleRequest(req, res) {
    // 超高速ヘッダー挿入
    res.setHeader('X-Proxy-Version', this.version);
    res.setHeader('X-Proxy-Name', 'ProXYRail');
    res.setHeader('X-Proxy-Uptime', String(Math.floor((Date.now() - this.startTime)/1000)));
    res.setHeader('X-Proxy-Requests', String(this.requestCount));

    if (req.method === 'CONNECT') {
      return this.handleConnect(req, res);
    }

    const parsed = urlModule.parse(req.url, true);
    const target = this.resolveTarget(req, parsed);

    if (!target) {
      this.errorCount++;
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1 style="color:#ff4444">Invalid target</h1>`);
      return;
    }

    // ブラウザ模倣ヘッダー
    req.headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    req.headers['accept-language'] = 'ja-JP,ja;q=0.9,en;q=0.8';
    req.headers['referer'] = this.config.domain ? `https://${this.config.domain}/` : 'https://google.com/';

    const acceptEncoding = (req.headers['accept-encoding'] || '').toLowerCase();
    let compress = false;
    if (acceptEncoding.includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip');
      compress = true;
    } else if (acceptEncoding.includes('deflate')) {
      res.setHeader('Content-Encoding', 'deflate');
      compress = true;
    } else if (acceptEncoding.includes('br')) {
      res.setHeader('Content-Encoding', 'br');
      compress = true;
    }

    this.proxyRequest(target, req, res, parsed, compress);
    this.requestCount++;
  }

  resolveTarget(req, parsed) {
    if (parsed.pathname.startsWith('/')) {
      return `${this.config.protocol}://${this.config.host}:${this.config.port}`;
    }
    return this.config.host;
  }

  proxyRequest(target, req, res, parsed, compress) {
    const options = {
      hostname: target,
      port: this.config.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: this.config.host },
      keepAlive: true,
      timeout: 30000
    };

    const proxyReq = https.request(options, (proxyRes) => {
      // ブラウザヘッダー追加
      proxyRes.headers['X-Proxy-Version'] = this.version;
      proxyRes.headers['X-Proxy-Name'] = 'ProXYRail';

      if (compress) {
        let compressor;
        if (res.getHeader('Content-Encoding') === 'gzip') compressor = zlib.createGzip();
        else if (res.getHeader('Content-Encoding') === 'deflate') compressor = zlib.createDeflate();
        else if (res.getHeader('Content-Encoding') === 'br') compressor = zlib.createBrotliCompress();
        else compressor = zlib.createGzip();

        const pipe = compressor;
        proxyRes.pipe(pipe).pipe(res);
      } else {
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      this.errorCount++;
      console.error(`❌ Proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end(`<h1>502 Bad Gateway: ${err.message}</h1>`);
      }
    });

    req.on('error', (err) => {
      this.errorCount++;
      console.error(`❌ Client error: ${err.message}`);
      if (proxyReq) proxyReq.abort();
    });

    req.pipe(proxyReq);
    this.activeConnections++;
    proxyReq.on('close', () => { this.activeConnections--; });
  }

  handleConnect(req, res) {
    const [hostname, port] = req.url.split(':');
    const targetPort = port || 443;
    const options = { hostname, port: targetPort };

    const proxySocket = https.request(options, (proxySocket) => {
      proxySocket.on('connect', () => {
        res.writeHead(200, { 'Proxy-Agent': 'ProXYRail/1.0' });
        res.connection.pipe(proxySocket).pipe(res.connection);
        this.activeConnections++;
        proxySocket.on('close', () => { this.activeConnections--; });
      });
    }).on('error', (err) => {
      this.errorCount++;
      res.writeHead(502);
      res.end(`<h1>502 Bad Gateway: ${err.message}</h1>`);
    });

    req.pipe(proxySocket);
  }

  async stop() {
    if (this.server) {
      this.server.close();
      this.isRunning = false;
      console.log(`🛑 ProXYRail stopped. Total requests: ${this.requestCount}`);
    }
  }
}

module.exports = Pipeline;
