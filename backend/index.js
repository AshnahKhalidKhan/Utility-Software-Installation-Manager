'use strict';

require('dotenv').config();

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/services/logger');
const routes = require('./src/api/routes');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach a unique request ID to every incoming request
app.use((req, _res, next) => {
  req.requestId = uuidv4();
  next();
});

// Access log
app.use((req, res, next) => {
  logger.info('→ incoming', {
    id:     req.requestId,
    method: req.method,
    path:   req.path,
    ip:     req.ip,
  });
  res.on('finish', () => {
    logger.info('← response', {
      id:     req.requestId,
      status: res.statusCode,
    });
  });
  next();
});

// ── API auth (skip in development) ───────────────────────────────────────────
app.use('/api', (req, res, next) => {
  if (process.env.NODE_ENV === 'development') return next();
  const secret = req.headers['x-api-secret'];
  if (!secret || secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-Api-Secret header' });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// Health probe — no auth required
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
);

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err, req, res, _next) => {
  logger.error('Unhandled exception', { id: req.requestId, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error', requestId: req.requestId });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Installer Manager Backend started`, {
    port: PORT,
    env:  process.env.NODE_ENV || 'development',
  });
});

module.exports = app; // exported for testing
