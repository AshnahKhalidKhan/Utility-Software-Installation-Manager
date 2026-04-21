'use strict';

const axios         = require('axios');
const { NodeSSH }   = require('node-ssh');
const { spawn }     = require('child_process');
const logger        = require('./logger');

const AGENT_SECRET = process.env.HELPER_AGENT_SECRET || '';

// ─────────────────────────────────────────────────────────────────────────────
// Method 1: Helper Agent REST API  (preferred — no firewall rule acrobatics)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an ordered list of commands through the Helper Agent's HTTP API.
 * Stops at the first failure.
 */
async function runViaHelperAgent(helperBaseUrl, commands, options = {}) {
  const { timeout = 300_000 } = options;

  logger.info('Executing via helper agent', {
    url: helperBaseUrl,
    count: commands.length,
  });

  const results = [];

  for (const command of commands) {
    try {
      const res = await axios.post(
        `${helperBaseUrl}/execute`,
        { command, timeout },
        {
          timeout:  timeout + 10_000,
          headers: {
            'Content-Type':    'application/json',
            'X-Agent-Secret':  AGENT_SECRET,
          },
        }
      );

      const { exitCode, stdout, stderr } = res.data;
      const success = exitCode === 0;

      results.push({ command, exitCode, stdout: stdout || '', stderr: stderr || '', success });

      logger.info('Helper command done', {
        cmd:      command.substring(0, 80),
        exitCode,
      });

      if (!success) {
        logger.warn('Command failed — stopping sequence', { command, stderr });
        break;
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      logger.error('Helper agent request failed', { command, error: msg });
      results.push({ command, exitCode: -1, stdout: '', stderr: msg, success: false });
      break;
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Method 2: SSH  (Linux / macOS fallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute commands over SSH.
 * Credentials come from environment variables; no secrets in source code.
 */
async function runRemoteSSH(host, commands, options = {}) {
  const {
    port           = 22,
    username       = process.env.SSH_USERNAME || 'admin',
    privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH,
    password       = process.env.SSH_PASSWORD,
  } = options;

  logger.info('Executing via SSH', { host, port, count: commands.length });

  const ssh = new NodeSSH();

  try {
    const cfg = { host, port, username, readyTimeout: 15_000 };
    if (privateKeyPath) cfg.privateKeyPath = privateKeyPath;
    else if (password)  cfg.password = password;

    await ssh.connect(cfg);
    logger.info('SSH connection established', { host, username });

    const results = [];

    for (const command of commands) {
      const { code, stdout, stderr } = await ssh.execCommand(command, {
        options: { pty: true },
      });

      const exitCode = code ?? 0;
      const success  = exitCode === 0;
      results.push({ command, exitCode, stdout: stdout || '', stderr: stderr || '', success });

      logger.info('SSH command done', { cmd: command.substring(0, 80), exitCode });

      if (!success) {
        logger.warn('SSH command failed — stopping', { command, stderr });
        break;
      }
    }

    return results;
  } finally {
    ssh.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Method 3: PowerShell Remoting / WinRM  (Windows fallback)
// ─────────────────────────────────────────────────────────────────────────────

/** Run a single command via Invoke-Command and capture output + exit code. */
function _psRemoteOne(host, command, { username, password, domain, port }) {
  return new Promise((resolve, reject) => {
    const fullUser  = domain ? `${domain}\\${username}` : username;
    // Escape single-quotes in the password for embedding in a PS string
    const safePwd   = password.replace(/'/g, "''");
    // Escape double-quotes in the command for embedding in a PS string
    const safeCmd   = command.replace(/"/g, '`"');

    const psScript = `
$sp = ConvertTo-SecureString '${safePwd}' -AsPlainText -Force
$cr = New-Object System.Management.Automation.PSCredential('${fullUser}', $sp)
$r  = Invoke-Command -ComputerName '${host}' -Port ${port} -Credential $cr -ScriptBlock {
        $out = & cmd /c "${safeCmd}" 2>&1
        @{ Output = ($out -join "\`n"); Exit = $LASTEXITCODE }
      } -ErrorAction Stop
Write-Output "##EXIT:$($r.Exit)##"
Write-Output $r.Output
`.trim();

    let stdout = '';
    let stderr = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      timeout: 120_000,
    });

    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    ps.on('close', code => {
      const m        = stdout.match(/##EXIT:(\d+)##/);
      const exitCode = m ? parseInt(m[1], 10) : (code ?? 1);
      const clean    = stdout.replace(/##EXIT:\d+##\r?\n?/g, '').trim();
      resolve({ command, exitCode, stdout: clean, stderr, success: exitCode === 0 && code === 0 });
    });

    ps.on('error', err => reject(new Error(`PowerShell spawn error: ${err.message}`)));
  });
}

/**
 * Execute commands via PowerShell Remoting (WinRM).
 * Requires PowerShell 5+ on the backend server and WinRM enabled on the target.
 */
async function runRemoteWindows(host, commands, options = {}) {
  const cfg = {
    port:     options.port || parseInt(process.env.WINRM_PORT || '5985'),
    username: process.env.WINRM_USERNAME || 'Administrator',
    password: process.env.WINRM_PASSWORD || '',
    domain:   process.env.WINRM_DOMAIN   || '',
  };

  logger.info('Executing via PowerShell Remoting', { host, count: commands.length });

  const results = [];
  for (const command of commands) {
    try {
      const r = await _psRemoteOne(host, command, cfg);
      results.push(r);
      logger.info('WinRM command done', { cmd: command.substring(0, 80), exitCode: r.exitCode });
      if (!r.success) {
        logger.warn('WinRM command failed — stopping', { command });
        break;
      }
    } catch (err) {
      logger.error('WinRM execution error', { command, error: err.message });
      results.push({ command, exitCode: -1, stdout: '', stderr: err.message, success: false });
      break;
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — tries methods in priority order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute commands on the target machine using the best available method.
 *
 * Priority:
 *   1. Helper Agent HTTP API
 *   2. PowerShell Remoting (Windows) or SSH (Linux/macOS)
 *
 * Returns: { method, results, success, error }
 */
async function executeCommands(machineInfo, commands, helperUrl = null) {
  const { os, ip, hostname, sshPort, winrmPort } = machineInfo;
  const host = ip || hostname;

  // ── Method 1: Helper Agent ────────────────────────────────────────────────
  if (helperUrl) {
    try {
      const results = await runViaHelperAgent(helperUrl, commands);
      return {
        method:  'helper-agent',
        results,
        success: results.every(r => r.success),
        error:   null,
      };
    } catch (err) {
      logger.warn('Helper agent execution failed, trying fallback', { error: err.message });
    }
  }

  // ── Method 2: OS-specific fallback ────────────────────────────────────────
  if (os === 'windows') {
    try {
      const results = await runRemoteWindows(host, commands, { port: winrmPort || 5985 });
      return {
        method:  'powershell-remoting',
        results,
        success: results.every(r => r.success),
        error:   null,
      };
    } catch (err) {
      logger.warn('PowerShell Remoting failed', { error: err.message });
      return { method: 'powershell-remoting', results: [], success: false, error: err.message };
    }
  } else {
    try {
      const results = await runRemoteSSH(host, commands, { port: sshPort || 22 });
      return {
        method:  'ssh',
        results,
        success: results.every(r => r.success),
        error:   null,
      };
    } catch (err) {
      logger.warn('SSH execution failed', { error: err.message });
      return { method: 'ssh', results: [], success: false, error: err.message };
    }
  }
}

module.exports = {
  runViaHelperAgent,
  runRemoteSSH,
  runRemoteWindows,
  executeCommands,
};
