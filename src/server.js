// src/url/server.js
const Resolver = require('./resolver');
const SessionManager = require('../network/session/manager');

class Server {
  constructor() {
    this.resolver = new Resolver();
    this.sessionManager = new SessionManager();
  }
  start() {
    const server = new (require('../core/pipeline'))({
      port: process.env.PORT || 8080,
      host: process.env.HOST || '0.0.0.0'
    });
    server.start();
  }
}
module.exports = Server;
