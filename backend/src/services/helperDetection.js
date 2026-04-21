'use strict';

const axios  = require('axios');
const logger = require('./logger');

const DEFAULT_PORT    = parseInt(process.env.HELPER_AGENT_PORT  || '7334');
const TIMEOUT_MS      = parseInt(process.env.HELPER_HEALTH_TIMEOUT_MS || '5000');
const AGENT_SECRET    = process.env.HELPER_AGENT_SECRET || '';
const DOWNLOAD_BASE   = process.env.HELPER_DOWNLOAD_URL || 'https://it.company.com/installer-agent';

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to reach the helper agent's /health endpoint on the target machine.
 *
 * Returns:
 *   { present: true,  url, version, os, hostname }
 *   { present: false }
 */
async function checkHelperPresence(machineInfo) {
  const { ip, hostname, helperPort = DEFAULT_PORT } = machineInfo;

  // Try both the IP address and the hostname (one might be reachable when
  // the other isn't, depending on DNS/routing).
  const hosts = [...new Set([ip, hostname].filter(Boolean))];

  for (const host of hosts) {
    const url = `http://${host}:${helperPort}/health`;
    try {
      logger.debug('Probing helper agent', { url });
      const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: { 'X-Agent-Secret': AGENT_SECRET },
      });

      if (res.status === 200 && res.data?.status === 'ok') {
        logger.info('Helper agent detected', {
          url,
          version:  res.data.version,
          agentOS:  res.data.os,
          agentHost: res.data.hostname,
        });
        return {
          present:  true,
          url:      `http://${host}:${helperPort}`,
          version:  res.data.version,
          os:       res.data.os,
          hostname: res.data.hostname,
        };
      }
    } catch (err) {
      logger.debug('Helper agent not reachable', { url, reason: err.message });
    }
  }

  logger.warn('Helper agent absent', { machine: hostname });
  return { present: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Installation instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a user-facing instruction object for installing the helper agent.
 * The message is designed to be surfaced directly in Microsoft Teams.
 */
function getHelperInstructions(machineInfo) {
  const { os = 'windows', hostname = 'your machine' } = machineInfo;

  const links = {
    windows: `${DOWNLOAD_BASE}/install-windows.ps1`,
    linux:   `${DOWNLOAD_BASE}/install-linux.sh`,
    macos:   `${DOWNLOAD_BASE}/install-macos.sh`,
  };

  const perOS = {
    windows: {
      title:       'Install Helper Agent on Windows',
      oneLineFmt:  `irm ${links.windows} | iex`,
      steps: [
        '1. Open **PowerShell as Administrator** on your machine.',
        `2. Paste and run:\n   \`\`\`powershell\n   irm ${links.windows} | iex\n   \`\`\``,
        '3. The agent installs and starts automatically as a Windows Service.',
        '4. Return here and re-send your original request.',
      ],
      downloadLink: links.windows,
    },
    linux: {
      title:      'Install Helper Agent on Linux',
      oneLineFmt: `curl -fsSL ${links.linux} | sudo bash`,
      steps: [
        '1. Open a terminal on your machine.',
        `2. Paste and run:\n   \`\`\`bash\n   curl -fsSL ${links.linux} | sudo bash\n   \`\`\``,
        '3. The agent installs and starts as a **systemd** service.',
        '4. Return here and re-send your original request.',
      ],
      downloadLink: links.linux,
    },
    macos: {
      title:      'Install Helper Agent on macOS',
      oneLineFmt: `curl -fsSL ${links.macos} | sudo bash`,
      steps: [
        '1. Open **Terminal** on your machine.',
        `2. Paste and run:\n   \`\`\`bash\n   curl -fsSL ${links.macos} | sudo bash\n   \`\`\``,
        '3. The agent installs and starts as a **launchd** daemon.',
        '4. Return here and re-send your original request.',
      ],
      downloadLink: links.macos,
    },
  };

  const info = perOS[os] || perOS.windows;

  return {
    required:     true,
    status:       'helper_required',
    message:      `⚠️ The **Installer Manager Helper Agent** is not installed on **${hostname}**.\n\nThis lightweight background service (~5 MB) is required to securely run installation commands on your machine.`,
    hostname,
    os,
    title:        info.title,
    steps:        info.steps,
    downloadLink: info.downloadLink,
    oneLineInstall: info.oneLineFmt,
    note:         'The agent communicates exclusively with this IT management system over a shared secret. It does not open any public ports.',
  };
}

module.exports = { checkHelperPresence, getHelperInstructions };
