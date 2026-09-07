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
  }

  async start() {
    this.isRunning = true;
    this.server = http.createServer(this.handleRequest.bind(this));
    this.server.listen(this.config.port, () => {
      console.log(`🚀 ProXYRail v${this.version} running on :${this.config.port}`);
    });
    console.log(`✅ Proxy ready - Domain: ${this.config.domain || 'any'}`);
  }

  async handleRequest(req, res) {
    // 高性能ヘッダー挿入
    res.setHeader('X-Proxy-Version', this.version);
    res.setHeader('X-Proxy-Name', 'ProXYRail');
    
    if (req.method === 'CONNECT') {
      return this.handleConnect(req, res);
    }
    
    const parsed = urlModule.parse(req.url, true);
    const target = this.resolveTarget(req, parsed);
    
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid target</h1>');
      return;
    }

    // レスポンス圧縮
    const acceptEncoding = req.headers['accept-encoding'] || '';
    let compress = false;
    if (acceptEncoding.includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip');
      compress = true;
    } else if (acceptEncoding.includes('deflate')) {
      res.setHeader('Content-Encoding', 'deflate');
      compress = true;
    }

    this.proxyRequest(target, req, res, parsed, compress);
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
      headers: { ...req.headers, host: this.config.host }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      if (compress) {
        const pipe = zlib.createGzip();
        proxyRes.pipe(pipe).pipe(res);
      } else {
        proxyRes.pipe(res);
      }
    });

    req.pipe(proxyReq);
  }

  handleConnect(req, res) {
    const [hostname, port] = req.url.split(':');
    const targetPort = port || 443;
    const options = { hostname, port: targetPort };

    const proxySocket = https.request(options, (proxySocket) => {
      proxySocket.on('connect', () => {
        res.writeHead(200, { 'Proxy-Agent': 'ProXYRail/1.0' });
        res.connection.pipe(proxySocket).pipe(res.connection);
      });
    }).on('error', (err) => {
      res.writeHead(502);
      res.end(`<h1>502 Bad Gateway: ${err.message}</h1>`);
    });

    req.pipe(proxySocket);
  }

  async stop() {
    if (this.server) {
      this.server.close();
      this.isRunning = false;
    }
  }
}

module.exports = Pipeline;
