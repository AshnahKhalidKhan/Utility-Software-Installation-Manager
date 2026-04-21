'use strict';

// Actions the system is permitted to execute
const ALLOWED_ACTIONS = new Set(['install', 'uninstall', 'update', 'check']);

// Commands that must never reach a remote machine under any circumstance
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~/i,
  /format\s+[a-z]:/i,
  /del\s+\/[sq]\s+[a-z]:\\/i,
  /shutdown\s+-[rh]/i,
  /halt\b/i,
  /poweroff\b/i,
  /net\s+user\s+.*\/delete/i,
  /reg\s+delete.*hklm/i,
  /fsutil\s/i,
  /diskpart\b/i,
  /bcdedit\b/i,
  /:()\{:|:&\};:/,                // fork bomb
  /\$\(.*rm.*\)/i,               // command-substitution rm
  />\s*\/dev\/s[dr][a-z]\d*/i,   // direct disk overwrite
  /dd\s+if=.*of=\/dev/i,
];

// Permitted software names (normalised to lowercase).
// Extend this list as needed — if a name is not here the request is rejected.
const ALLOWED_SOFTWARE = new Set([
  // JavaScript / Node ecosystem
  'nodejs', 'node', 'npm', 'yarn', 'pnpm', 'bun',
  // Python
  'python', 'python2', 'python3', 'pip', 'pip3', 'conda', 'miniconda', 'anaconda',
  // Git & SCM
  'git', 'git-lfs', 'svn', 'mercurial',
  // Containers / VMs
  'docker', 'docker-desktop', 'docker-compose', 'podman', 'virtualbox', 'vagrant',
  // IDEs / editors
  'vscode', 'visual-studio-code', 'visual-studio', 'vs2022', 'vs2019',
  'intellij', 'pycharm', 'rider', 'webstorm', 'notepad++', 'notepadplusplus', 'vim', 'neovim',
  // Browsers
  'chrome', 'google-chrome', 'firefox', 'edge', 'brave',
  // Databases
  'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'redis',
  'sqlite', 'mssql', 'sql-server', 'sqlserver', 'ssms',
  'elasticsearch', 'opensearch', 'cassandra', 'dynamodb',
  // Java
  'java', 'jdk', 'jre', 'openjdk', 'temurin', 'maven', 'gradle',
  // .NET
  'dotnet', '.net', 'dotnet-sdk', 'dotnet-runtime',
  // Systems languages
  'rust', 'cargo', 'go', 'golang', 'c', 'cpp', 'gcc', 'clang', 'cmake',
  // Scripting
  'ruby', 'rbenv', 'rvm', 'php', 'perl',
  // Web servers / proxies
  'nginx', 'apache', 'httpd', 'caddy', 'traefik',
  // Messaging / queues
  'rabbitmq', 'kafka', 'activemq', 'nats',
  // DevOps / CI
  'jenkins', 'github-actions-runner', 'gitlab-runner', 'ansible', 'terraform', 'kubectl', 'helm',
  // Utilities
  '7zip', '7-zip', 'curl', 'wget', 'jq', 'yq', 'unzip',
  'openssh', 'putty', 'winscp',
  'postman', 'insomnia', 'httpie',
  'vlc', 'zoom', 'teams', 'slack', 'discord',
  // Package managers / runtimes
  'winget', 'chocolatey', 'choco', 'homebrew', 'brew', 'scoop',
  'nvm', 'pyenv', 'sdkman',
  // Misc
  'awscli', 'azure-cli', 'gcloud', 'firebase-tools',
  'typescript', 'ts-node', 'eslint', 'prettier',
]);

/**
 * Returns true if the action string is in the allowed set.
 */
function isActionAllowed(action) {
  return ALLOWED_ACTIONS.has(action?.toLowerCase());
}

/**
 * Returns true if the software name is in the allowlist.
 */
function isSoftwareAllowed(softwareName) {
  return ALLOWED_SOFTWARE.has(softwareName?.toLowerCase());
}

/**
 * Returns true only when the command contains no blocked patterns.
 */
function isCommandSafe(command) {
  if (!command || typeof command !== 'string') return false;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return false;
  }
  return true;
}

/**
 * Validates a fully-parsed command object.
 * Returns { valid: boolean, errors: string[] }.
 */
function validateRequest(parsedCommand) {
  const errors = [];

  if (!isActionAllowed(parsedCommand.action)) {
    errors.push(`Action "${parsedCommand.action}" is not permitted`);
  }

  for (const sw of parsedCommand.software || []) {
    if (!isSoftwareAllowed(sw)) {
      errors.push(`Software "${sw}" is not in the allowlist — contact IT to add it`);
    }
  }

  const allCmds = [
    ...(parsedCommand.osCommands?.windows?.preCommands  || []),
    ...(parsedCommand.osCommands?.windows?.commands     || []),
    ...(parsedCommand.osCommands?.windows?.postCommands || []),
    ...(parsedCommand.osCommands?.linux?.preCommands    || []),
    ...(parsedCommand.osCommands?.linux?.commands       || []),
    ...(parsedCommand.osCommands?.linux?.postCommands   || []),
    ...(parsedCommand.osCommands?.macos?.preCommands    || []),
    ...(parsedCommand.osCommands?.macos?.commands       || []),
    ...(parsedCommand.osCommands?.macos?.postCommands   || []),
  ];

  for (const cmd of allCmds) {
    if (!isCommandSafe(cmd)) {
      errors.push(`Command blocked by safety policy: "${cmd.substring(0, 80)}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  isActionAllowed,
  isSoftwareAllowed,
  isCommandSafe,
  validateRequest,
  ALLOWED_SOFTWARE,
  ALLOWED_ACTIONS,
};
