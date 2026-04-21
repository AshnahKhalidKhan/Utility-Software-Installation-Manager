#!/usr/bin/env node
/**
 * Smoke-test the backend API end-to-end.
 * Run:  node examples/test-request.js
 *
 * Set TEST_API_URL env var to point at a non-local backend.
 * Set API_SECRET env var if NODE_ENV is not 'development'.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('http');
const http  = require('http');

const BASE_URL   = process.env.TEST_API_URL || 'http://localhost:3000';
const API_SECRET = process.env.API_SECRET   || '';

// ── Minimal fetch wrapper (no dependencies) ───────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);
    const lib     = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Api-Secret':   API_SECRET,
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'X-Api-Secret': API_SECRET },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Test cases ────────────────────────────────────────────────────────────────
const TESTS = [
  {
    name: 'Health check',
    run:  () => get(`${BASE_URL}/health`),
    check: r => r.status === 200 && r.body.status === 'ok',
  },
  {
    name: 'Unknown user → 404',
    run:  () => post(`${BASE_URL}/api/execute`, { user: 'ghost@company.com', command: 'Install Git' }),
    check: r => r.status === 404 && r.body.status === 'error',
  },
  {
    name: 'Missing body fields → 400',
    run:  () => post(`${BASE_URL}/api/execute`, { user: 'user@company.com' }),
    check: r => r.status === 400,
  },
  {
    name: 'Helper instructions endpoint — Windows',
    run:  () => get(`${BASE_URL}/api/helper/instructions/windows`),
    check: r => r.status === 200 && r.body.oneLineInstall,
  },
  {
    name: 'Helper instructions endpoint — Linux',
    run:  () => get(`${BASE_URL}/api/helper/instructions/linux`),
    check: r => r.status === 200 && r.body.steps?.length > 0,
  },
  {
    name: 'Register a machine',
    run:  () => post(`${BASE_URL}/api/machines/register`, {
      user: 'testuser@company.com',
      hostname: 'TEST-PC-01',
      os: 'windows',
      ip: '10.0.0.99',
      helperPort: 7334,
    }),
    check: r => r.status === 200 && r.body.status === 'registered',
  },
  {
    name: 'Get registered machine',
    run:  () => get(`${BASE_URL}/api/machines/testuser@company.com`),
    check: r => r.status === 200 && r.body.hostname === 'TEST-PC-01',
  },
  {
    name: 'Install Node.js (full flow — helper probably absent → helper_required)',
    run:  () => post(`${BASE_URL}/api/execute`, { user: 'user@company.com', command: 'Install Node.js' }),
    check: r => [200, 404, 422].includes(r.status),
    note:  'Expect helper_required if no agent is running at 192.168.1.10:7334',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🧪 Installer Manager Backend — smoke tests`);
  console.log(`   Target: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`  ${t.name.padEnd(55)} `);
    try {
      const result = await t.run();
      if (t.check(result)) {
        console.log('✅ PASS');
        if (t.note) console.log(`     ℹ ${t.note}`);
        passed++;
      } else {
        console.log('❌ FAIL');
        console.log(`     Status: ${result.status}`);
        console.log(`     Body  : ${JSON.stringify(result.body).substring(0, 200)}`);
        failed++;
      }
    } catch (err) {
      console.log(`💥 ERROR: ${err.message}`);
      if (err.code === 'ECONNREFUSED') {
        console.log('     ↳ Is the backend running? npm start');
      }
      failed++;
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
