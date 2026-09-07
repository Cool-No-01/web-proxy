// src/core/network/http.js
module.exports = {
  createRequest: (url, options) => {
    return require('https').request(url, options);
  }
};
