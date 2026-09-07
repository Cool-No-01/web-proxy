// src/network/session/cookie-jar.js
class CookieJar {
  constructor() {
    this.cookies = {};
  }
  set(name, value, domain) {
    this.cookies[domain] = this.cookies[domain] || {};
    this.cookies[domain][name] = value;
  }
}
module.exports = CookieJar;
