'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

const MACHINES_FILE =
  process.env.MACHINES_FILE ||
  path.join(__dirname, '../config/machines.json');

let registry = null;

/** Load (or reload) the registry from disk. */
function loadRegistry() {
  try {
    const raw = fs.readFileSync(MACHINES_FILE, 'utf8');
    registry = JSON.parse(raw);
    logger.info(`Machine registry loaded — ${Object.keys(registry).length} entries`, {
      file: MACHINES_FILE,
    });
  } catch (err) {
    logger.error('Failed to load machine registry', { error: err.message, file: MACHINES_FILE });
    registry = {};
  }
  return registry;
}

/** Persist the current registry to disk. */
function saveRegistry() {
  try {
    fs.writeFileSync(MACHINES_FILE, JSON.stringify(registry, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error('Failed to save machine registry', { error: err.message });
    return false;
  }
}

/**
 * Resolve the machine record for a given user e-mail.
 * Returns null when the user has no registered machine.
 */
function getMachineForUser(userEmail) {
  if (!registry) loadRegistry();

  const key = userEmail?.toLowerCase().trim();
  const machine = registry[key];

  if (!machine) {
    logger.warn('No machine registered for user', { user: userEmail });
    return null;
  }

  return { ...machine, userEmail: key };
}

/**
 * Register or update the machine record for a user.
 * Returns true on success.
 */
function registerMachine(userEmail, machineInfo) {
  if (!registry) loadRegistry();

  const key = userEmail.toLowerCase().trim();
  registry[key] = {
    ...machineInfo,
    updatedAt: new Date().toISOString(),
  };

  const ok = saveRegistry();
  if (ok) {
    logger.info('Machine registered', { user: key, hostname: machineInfo.hostname });
  }
  return ok;
}

// Eager load on module init
loadRegistry();

module.exports = { getMachineForUser, registerMachine, loadRegistry };
