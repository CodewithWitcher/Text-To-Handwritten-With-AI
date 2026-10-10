#!/usr/bin/env node
/**
 * One-command launcher:  npx text-to-handwriting-ai
 *
 * Serves the app and relays AI requests (same behaviour as server.py) so any
 * provider works without browser CORS errors, then opens the browser.
 * No dependencies; needs Node 18+.
 *
 *   npx text-to-handwriting-ai [--port 8080] [--host 127.0.0.1] [--no-open]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 40 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 600000;
const FORWARDED_HEADERS = new Set([
  'authorization',
  'content-type',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'http-referer',
  'x-title',
  'api-key'
]);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

/* ------------------------------ arguments ------------------------------ */

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Text to Handwriting AI

Usage: npx text-to-handwriting-ai [options]

  --port <n>    Port to use (default 8080, or the next free one)
  --host <h>    Address to listen on (default 127.0.0.1)
  --no-open     Don't open the browser
  -h, --help    Show this help`);
  process.exit(0);
}
const HOST = opt('--host', process.env.HOST || '127.0.0.1');
const PORT = Number(opt('--port', process.env.PORT || 8080));
const OPEN = !args.includes('--no-open');

/* ------------------------------- helpers ------------------------------- */

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isAllowedTarget(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && u.hostname) return true;
  // Plain http only for local model servers (Ollama etc.).
  return (
    u.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* -------------------------------- routes ------------------------------- */

async function proxy(req, res) {
  // Reject cross-site requests so other websites can't use this relay.
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    return sendJSON(res, 403, {
      error: 'Cross-origin requests are not allowed.'
    });
  }
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    return sendJSON(res, 415, { error: 'Expected application/json.' });
  }
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return sendJSON(res, e.message === 'too large' ? 413 : 400, {
      error:
        e.message === 'too large' ? 'Request body too large.' : 'Invalid JSON.'
    });
  }
  const { url = '', body } = payload;
  const method = String(payload.method || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    return sendJSON(res, 400, { error: 'Only GET and POST are supported.' });
  }
  if (!isAllowedTarget(url)) {
    return sendJSON(res, 400, { error: `Target URL is not allowed: ${url}` });
  }
  const headers = {};
  for (const [k, v] of Object.entries(payload.headers || {})) {
    if (FORWARDED_HEADERS.has(k.toLowerCase()) && typeof v === 'string')
      headers[k] = v;
  }
  if (
    method === 'POST' &&
    !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  ) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    const upstream = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type':
        upstream.headers.get('content-type') || 'application/json',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  } catch (e) {
    if (e.name === 'TimeoutError') {
      return sendJSON(res, 504, {
        error: 'The AI provider took too long to respond.'
      });
    }
    sendJSON(res, 502, {
      error: `Could not reach ${url} (${e.cause?.code || e.message})`
    });
  }
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const parts = pathname.split('/').filter(Boolean);
  // Never serve hidden files, dependencies or the launcher itself.
  if (
    parts.some((p) => p.startsWith('.')) ||
    ['node_modules', 'bin'].includes(parts[0])
  ) {
    res.writeHead(404).end('Not found');
    return;
  }
  let file = path.join(ROOT, ...parts);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type':
          TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/health' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, proxy: true });
  }
  if (url === '/api/proxy') {
    if (req.method !== 'POST')
      return sendJSON(res, 405, { error: 'Use POST.' });
    proxy(req, res).catch((e) => sendJSON(res, 500, { error: e.message }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

/* -------------------------------- start -------------------------------- */

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* no browser available (e.g. a server); the URL is printed anyway */
  }
}

// One handler for the whole server: if a port is busy we retry the next one,
// and only the port that actually opens is reported.
let attempt = PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempt < PORT + 10) {
    attempt += 1;
    server.listen(attempt, HOST);
  } else {
    console.error(`Could not start: ${err.message}`);
    process.exit(1);
  }
});
server.on('listening', () => {
  const { port } = server.address();
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const url = `http://${shown}:${port}`;
  if (port !== PORT)
    console.log(`\n  Port ${PORT} is busy, using ${port} instead.`);
  console.log(
    `\n  Text to Handwriting AI is running at ${url}\n  Press Ctrl+C to stop.\n`
  );
  if (OPEN) openBrowser(url);
});
server.listen(attempt, HOST);
process.on('SIGINT', () => {
  console.log('\nStopped.');
  process.exit(0);
});
