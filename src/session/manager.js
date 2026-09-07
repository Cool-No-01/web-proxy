// src/network/session/manager.js
const CookieJar = require('./cookie-jar');

class SessionManager {
  constructor() {
    this.jars = {};
  }
  getJar(domain) {
    if (!this.jars[domain]) this.jars[domain] = new CookieJar();
    return this.jars[domain];
  }
}
module.exports = SessionManager;
