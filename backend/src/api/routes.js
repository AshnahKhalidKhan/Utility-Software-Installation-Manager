'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const { getMachineForUser, registerMachine } = require('../services/machineMapping');
const { checkHelperPresence, getHelperInstructions } = require('../services/helperDetection');
const { parseCommand }          = require('../services/commandParser');
const { executeCommands }       = require('../services/remoteExecution');
const { generateFallbackScript } = require('../services/scriptGenerator');
const { validateRequest }       = require('../config/allowlist');
const logger = require('../services/logger');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/execute
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main endpoint — receives a natural-language command from the Teams bot
 * and orchestrates the full install/uninstall flow.
 *
 * Body: { user: "email@company.com", command: "Install Node.js and npm" }
 */
router.post('/execute', async (req, res) => {
  const requestId = req.requestId || uuidv4();
  const { user, command } = req.body || {};

  if (!user || !command) {
    return res.status(400).json({
      status: 'error',
      requestId,
      error:  'Request body must contain "user" and "command".',
    });
  }

  logger.info('Execute request', { requestId, user, command });

  try {
    // ── Step 1: Identify target machine ──────────────────────────────────────
    const machine = getMachineForUser(user);
    if (!machine) {
      return res.status(404).json({
        status:    'error',
        requestId,
        error:     `No machine registered for "${user}". Ask IT to register your device first.`,
      });
    }
    logger.info('Machine identified', { requestId, hostname: machine.hostname, os: machine.os });

    // ── Step 2: Check helper agent presence ───────────────────────────────────
    const helperStatus = await checkHelperPresence(machine);

    if (!helperStatus.present) {
      logger.warn('Helper agent absent — returning install instructions', {
        requestId,
        hostname: machine.hostname,
      });
      return res.status(200).json({
        ...getHelperInstructions(machine),
        requestId,
      });
    }

    logger.info('Helper agent confirmed', {
      requestId,
      helperUrl: helperStatus.url,
      version:   helperStatus.version,
    });

    // ── Step 3: Parse natural-language command with Claude AI ────────────────
    let parsed;
    try {
      parsed = await parseCommand(command, machine.os);
    } catch (parseErr) {
      logger.error('Command parse failure', { requestId, error: parseErr.message });
      return res.status(422).json({
        status:    'error',
        requestId,
        error:     `Could not understand the request: ${parseErr.message}`,
        hint:      'Try something like "Install Git" or "Uninstall Python 3.11".',
      });
    }

    logger.info('Command parsed', {
      requestId,
      action:   parsed.action,
      software: parsed.software,
    });

    // ── Step 4: Validate against security allowlist ───────────────────────────
    const validation = validateRequest(parsed);
    if (!validation.valid) {
      logger.warn('Request blocked by allowlist', { requestId, errors: validation.errors });
      return res.status(403).json({
        status:    'blocked',
        requestId,
        error:     'This request was blocked by the IT security policy.',
        details:   validation.errors,
      });
    }

    // ── Step 5: Build OS-specific command list ────────────────────────────────
    const osKey = machine.os === 'macos' ? 'macos'
                : machine.os === 'linux' ? 'linux'
                : 'windows';

    const osCmds = parsed.osCommands?.[osKey];
    if (!osCmds?.commands?.length) {
      return res.status(422).json({
        status:    'error',
        requestId,
        error:     `No commands available for OS "${machine.os}".`,
      });
    }

    const allCommands = [
      ...(osCmds.preCommands  || []),
      ...osCmds.commands,
      ...(osCmds.postCommands || []),
    ];

    // ── Step 6: Execute ───────────────────────────────────────────────────────
    logger.info('Starting execution', { requestId, commandCount: allCommands.length });

    const execResult = await executeCommands(machine, allCommands, helperStatus.url);

    // ── Step 7: Fallback on failure ───────────────────────────────────────────
    if (!execResult.success) {
      const failed = execResult.results.find(r => !r.success);
      logger.warn('Execution failed — generating fallback script', {
        requestId,
        method: execResult.method,
        reason: failed?.stderr || execResult.error,
      });

      const fallback = generateFallbackScript(parsed, machine);
      return res.status(200).json({
        ...fallback,
        requestId,
        hostname:      machine.hostname,
        failedCommand: failed?.command || null,
        failureReason: failed?.stderr  || execResult.error || 'Unknown error',
        message:       `Remote execution failed on ${machine.hostname}. Use the script below to install manually.`,
      });
    }

    // ── Step 8: Verification ──────────────────────────────────────────────────
    let verificationOutput = '';
    const verifyCmds = parsed.verify?.commands || [];

    if (verifyCmds.length) {
      try {
        const verifyResult = await executeCommands(machine, verifyCmds, helperStatus.url);
        verificationOutput = verifyResult.results
          .filter(r => r.success && r.stdout)
          .map(r => r.stdout.trim())
          .join('\n');
      } catch (vErr) {
        logger.warn('Verification step failed (non-fatal)', { error: vErr.message });
      }
    }

    // ── Step 9: Format success response ──────────────────────────────────────
    const softwareList = (parsed.displayNames || parsed.software).join(', ');
    const actionPast   = parsed.action === 'install'   ? 'installed'
                       : parsed.action === 'uninstall' ? 'uninstalled'
                       : parsed.action;

    logger.info('Execution succeeded', { requestId, software: softwareList });

    return res.status(200).json({
      status:          'success',
      requestId,
      message:         `✅ ${softwareList} ${actionPast} successfully on **${machine.hostname}**.`,
      hostname:        machine.hostname,
      os:              machine.os,
      action:          parsed.action,
      software:        parsed.displayNames || parsed.software,
      executionMethod: execResult.method,
      steps:           execResult.results.map(r => ({
        command: r.command,
        success: r.success,
        output:  (r.stdout || '').substring(0, 500),
      })),
      verification:  verificationOutput || '(verification not available)',
      requiresReboot: parsed.requiresReboot || false,
    });

  } catch (err) {
    logger.error('Unhandled error in /execute', {
      requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      status:    'error',
      requestId,
      error:     `Internal server error: ${err.message}`,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/machines/register
// ─────────────────────────────────────────────────────────────────────────────

router.post('/machines/register', (req, res) => {
  const { user, hostname, os, ip, helperPort, sshPort, winrmPort } = req.body || {};

  if (!user || !hostname || !os || !ip) {
    return res.status(400).json({
      error: 'Required fields: user, hostname, os, ip',
    });
  }

  if (!['windows', 'linux', 'macos'].includes(os)) {
    return res.status(400).json({ error: 'os must be one of: windows, linux, macos' });
  }

  const ok = registerMachine(user, { hostname, os, ip, helperPort, sshPort, winrmPort });
  return ok
    ? res.json({ status: 'registered', user, hostname })
    : res.status(500).json({ error: 'Failed to save machine registry' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/machines/:user
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machines/:user', (req, res) => {
  const machine = getMachineForUser(req.params.user);
  return machine
    ? res.json(machine)
    : res.status(404).json({ error: 'Machine not found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/helper/instructions/:os
// ─────────────────────────────────────────────────────────────────────────────

router.get('/helper/instructions/:os', (req, res) => {
  const { os } = req.params;
  if (!['windows', 'linux', 'macos'].includes(os)) {
    return res.status(400).json({ error: 'os must be one of: windows, linux, macos' });
  }
  return res.json(getHelperInstructions({ os, hostname: 'your-machine' }));
});

module.exports = router;
