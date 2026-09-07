// src/core/proxy.js
const Pipeline = require('./pipeline');

const config = {
  port: parseInt(process.env.PROXY_PORT || '8080'),
  host: process.env.HOST || 'example.com',
  domain: process.env.DOMAIN,
  protocol: 'https'
};

const proxy = new Pipeline(config);
proxy.start();
