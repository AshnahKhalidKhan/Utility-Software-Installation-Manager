#!/usr/bin/env node
/**
 * Installer Manager Helper Agent
 * ────────────────────────────────
 * Lightweight HTTP server that runs on the end-user's machine.
 * The backend calls it to execute installation commands locally.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 *
 * Endpoints
 *   GET  /health    → liveness probe (no auth required)
 *   GET  /os-info   → OS details
 *   POST /execute   → run a shell command and return stdout/stderr/exitCode
 *
 * Auth: every protected endpoint requires the header
 *   X-Agent-Secret: <value of AGENT_SECRET env var>
 * If AGENT_SECRET is empty, auth is skipped (only safe on a trusted network).
 */

'use strict';

const http  = require('http');
const { exec } = require('child_process');
const os    = require('os');
const fs    = require('fs');
const path  = require('path');

// ── Config (from environment or .env file) ───────────────────────────────────

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const PORT         = parseInt(process.env.AGENT_PORT   || '7334');
const AGENT_SECRET = process.env.AGENT_SECRET          || '';
const VERSION      = '1.0.0';
const MAX_TIMEOUT  = 600_000; // 10 min hard cap

// ── Blocked command patterns ─────────────────────────────────────────────────

const BLOCKED = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~/i,
  /format\s+[a-z]:/i,
  /del\s+\/[sq]\s+[a-z]:\\/i,
  /:()\{:|:&\};:/,              // fork bomb
  />\s*\/dev\/s[dr][a-z]\d*/i,  // direct disk write
  /dd\s+if=.*of=\/dev/i,
  /shutdown\s+-[rh]/i,
  /halt\b/i,
  /poweroff\b/i,
];

function isSafe(cmd) {
  return !BLOCKED.some(p => p.test(cmd));
}

// ── Command execution ────────────────────────────────────────────────────────

function runCommand(command, timeoutMs) {
  return new Promise(resolve => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    const opts  = {
      shell,
      timeout:   Math.min(timeoutMs, MAX_TIMEOUT),
      maxBuffer: 10 * 1024 * 1024,
      env:       { ...process.env },
    };

    const start = Date.now();
    exec(command, opts, (err, stdout, stderr) => {
      resolve({
        exitCode: err?.code  ?? 0,
        stdout:   stdout     || '',
        stderr:   stderr     || (err?.killed ? 'Command timed out' : err?.message || ''),
        elapsed:  Date.now() - start,
      });
    });
  });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; });
    req.on('end',  () => {
      try   { resolve(buf ? JSON.parse(buf) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function reply(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function authOk(req) {
  if (!AGENT_SECRET) return true;                        // no secret configured → open
  return req.headers['x-agent-secret'] === AGENT_SECRET;
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handle(req, res) {
  const { pathname } = new URL(req.url, `http://localhost`);

  // CORS pre-flight
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Secret');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // ── GET /health — no auth ────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/health') {
    reply(res, 200, {
      status:    'ok',
      version:   VERSION,
      os:        process.platform,
      hostname:  os.hostname(),
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (!authOk(req)) {
    reply(res, 401, { error: 'Unauthorized' });
    return;
  }

  // ── GET /os-info ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/os-info') {
    reply(res, 200, {
      platform: process.platform,
      release:  os.release(),
      arch:     os.arch(),
      hostname: os.hostname(),
      cpus:     os.cpus().length,
      memoryGB: (os.totalmem() / 1024 ** 3).toFixed(1),
    });
    return;
  }

  // ── POST /execute ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/execute') {
    let body;
    try   { body = await readBody(req); }
    catch { reply(res, 400, { error: 'Invalid JSON body' }); return; }

    const { command, timeout = 300_000 } = body;

    if (!command || typeof command !== 'string' || !command.trim()) {
      reply(res, 400, { error: 'Missing or empty "command" field' });
      return;
    }

    if (!isSafe(command)) {
      console.warn(`[BLOCKED] ${command.substring(0, 100)}`);
      reply(res, 403, { error: 'Command blocked by safety policy' });
      return;
    }

    console.log(`[EXEC] ${command.substring(0, 120)}`);
    const result = await runCommand(command, Number(timeout) || 300_000);
    console.log(`[DONE] exit=${result.exitCode} elapsed=${result.elapsed}ms`);

    reply(res, 200, result);
    return;
  }

  reply(res, 404, { error: 'Not Found' });
}

// ── Start server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('[ERROR]', err);
    try { reply(res, 500, { error: 'Internal error' }); } catch { /* already sent */ }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Installer Manager Helper Agent  v' + VERSION + '   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Port    : ${PORT}`);
  console.log(`  OS      : ${process.platform} / ${os.hostname()}`);
  console.log(`  Auth    : ${AGENT_SECRET ? 'enabled (X-Agent-Secret)' : 'DISABLED — set AGENT_SECRET in .env'}`);
  console.log('');
});

process.on('SIGTERM', () => { console.log('Shutting down…'); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { console.log('Shutting down…'); server.close(() => process.exit(0)); });
