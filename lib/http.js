'use strict';

const http = require('http');
const https = require('https');

// Minimal HTTP client for the firmware 1.x robot API and the old cloud API.
// The robot serves a self-signed certificate, so certificate checks can be
// turned off with `strictSSL: false`, which fetch() can't do portably.
function send (options) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.uri);
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(url, {
      method: options.method || 'GET',
      headers: options.headers,
      rejectUnauthorized: options.strictSSL !== false,
      timeout: options.timeout || 30000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString()
      }));
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Resolves with the response body, rejects on non-2xx responses.
function request (options) {
  return send(options).then((res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const error = new Error(res.statusCode + ' - ' + res.body);
      error.statusCode = res.statusCode;
      error.body = res.body;
      throw error;
    }
    return res.body;
  });
}

module.exports = {
  send,
  request
};
