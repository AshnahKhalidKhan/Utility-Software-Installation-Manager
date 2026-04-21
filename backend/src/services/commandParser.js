'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('./logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition — forces Claude to return structured, validated output
// ─────────────────────────────────────────────────────────────────────────────

const PARSE_TOOL = {
  name: 'parse_software_command',
  description:
    'Convert a natural-language software install/uninstall request into structured, OS-specific shell commands.',
  input_schema: {
    type: 'object',
    required: [
      'action', 'software', 'displayNames',
      'requiresPassword', 'osCommands', 'verify',
      'requiresReboot', 'adminRequired',
    ],
    properties: {
      action: {
        type: 'string',
        enum: ['install', 'uninstall', 'update', 'check'],
        description: 'The action to perform.',
      },
      software: {
        type: 'array',
        items: { type: 'string' },
        description: 'Normalised lowercase package names, e.g. ["nodejs","npm"].',
      },
      displayNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Human-readable names for user-facing messages, e.g. ["Node.js","npm"].',
      },
      requiresPassword: {
        type: 'boolean',
        description:
          'True when the software needs a password during setup (databases, admin panels, etc.).',
      },
      osCommands: {
        type: 'object',
        required: ['windows', 'linux', 'macos'],
        properties: {
          windows: {
            type: 'object',
            required: ['commands'],
            properties: {
              preCommands:  { type: 'array', items: { type: 'string' } },
              commands:     { type: 'array', items: { type: 'string' } },
              postCommands: { type: 'array', items: { type: 'string' } },
            },
          },
          linux: {
            type: 'object',
            required: ['commands'],
            properties: {
              preCommands:  { type: 'array', items: { type: 'string' } },
              commands:     { type: 'array', items: { type: 'string' } },
              postCommands: { type: 'array', items: { type: 'string' } },
            },
          },
          macos: {
            type: 'object',
            required: ['commands'],
            properties: {
              preCommands:  { type: 'array', items: { type: 'string' } },
              commands:     { type: 'array', items: { type: 'string' } },
              postCommands: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      verify: {
        type: 'object',
        required: ['commands'],
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Commands that confirm successful install, e.g. ["node --version"].',
          },
        },
      },
      requiresReboot: {
        type: 'boolean',
        description: 'True if a system restart is needed after install.',
      },
      adminRequired: {
        type: 'boolean',
        description: 'True if admin / root privileges are required.',
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// System prompt (cached — same across all requests)
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert IT automation engineer.
Your task: convert natural-language software requests into precise, silent, non-interactive
OS-specific shell commands for Windows, Linux (Ubuntu/Debian), and macOS.

## Package manager preferences
- Windows  → winget (primary), then Chocolatey, then MSI/PowerShell
- Linux    → apt-get with DEBIAN_FRONTEND=noninteractive
- macOS    → Homebrew (brew)

## Silent install flags (always include)
- winget:   --accept-source-agreements --accept-package-agreements --disable-interactivity
- apt-get:  DEBIAN_FRONTEND=noninteractive -y
- brew:     --quiet (where supported)

## Password injection
When software requires a password during setup (MySQL, PostgreSQL, MongoDB, Redis with auth,
Elasticsearch, RabbitMQ, Jenkins, etc.) use the placeholder {{PASSWORD}} exactly.
The backend will replace it with the real credential before execution.

## Examples

### Install Node.js and npm
- software: ["nodejs","npm"]
- Windows commands: ["winget install OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --disable-interactivity"]
- Linux   commands: ["sudo DEBIAN_FRONTEND=noninteractive apt-get update -y","sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm"]
- macOS   commands: ["brew install node"]
- verify:  ["node --version","npm --version"]
- requiresPassword: false

### Install PostgreSQL
- software: ["postgresql"]
- Windows:
    commands: ["winget install PostgreSQL.PostgreSQL -e --accept-source-agreements --accept-package-agreements --disable-interactivity"]
    postCommands: ["& 'C:\\\\Program Files\\\\PostgreSQL\\\\16\\\\bin\\\\psql.exe' -U postgres -c \\"ALTER USER postgres PASSWORD '{{PASSWORD}}';\\""]
- Linux:
    preCommands:  ["export DEBIAN_FRONTEND=noninteractive"]
    commands:     ["sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib"]
    postCommands: ["sudo -u postgres psql -c \\"ALTER USER postgres PASSWORD '{{PASSWORD}}';\\""  ]
- macOS:
    commands:     ["brew install postgresql@16","brew services start postgresql@16"]
    postCommands: ["/usr/local/opt/postgresql@16/bin/psql -U postgres -c \\"ALTER USER postgres PASSWORD '{{PASSWORD}}';\\""  ]
- requiresPassword: true

### Uninstall Python
- action: "uninstall"
- Windows: ["winget uninstall Python.Python.3 --disable-interactivity"]
- Linux:   ["sudo apt-get remove -y python3","sudo apt-get autoremove -y"]
- macOS:   ["brew uninstall python"]

Always output using the parse_software_command tool. Never add explanatory text outside the tool call.`;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a natural-language command into a structured action object.
 *
 * @param {string} userCommand   e.g. "Install Node.js and npm on my machine"
 * @param {string|null} targetOS  'windows' | 'linux' | 'macos' | null
 * @returns {Promise<object>} parsed command with osCommands, verify, etc.
 */
async function parseCommand(userCommand, targetOS = null) {
  logger.info('Parsing command', { command: userCommand, targetOS });

  const userMessage = targetOS
    ? `Parse this request (target OS: ${targetOS}): "${userCommand}"`
    : `Parse this request: "${userCommand}"`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type:          'text',
        text:          SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // prompt caching — reused across requests
      },
    ],
    tools:        [PARSE_TOOL],
    tool_choice:  { type: 'tool', name: 'parse_software_command' },
    messages:     [{ role: 'user', content: userMessage }],
  });

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock) {
    throw new Error('Model did not return the expected tool call');
  }

  const parsed = toolBlock.input;

  // ── Password injection ──────────────────────────────────────────────────────
  if (parsed.requiresPassword) {
    const PASSWORD = process.env.DEFAULT_SOFTWARE_PASSWORD || 'R0ll3rcoaster#123456';
    for (const osKey of ['windows', 'linux', 'macos']) {
      const block = parsed.osCommands?.[osKey];
      if (!block) continue;
      for (const phase of ['preCommands', 'commands', 'postCommands']) {
        if (Array.isArray(block[phase])) {
          block[phase] = block[phase].map(cmd =>
            cmd.replace(/\{\{PASSWORD\}\}/g, PASSWORD)
          );
        }
      }
    }
    logger.debug('Password injected into generated commands');
  }

  logger.info('Command parsed', {
    action:          parsed.action,
    software:        parsed.software,
    requiresPassword: parsed.requiresPassword,
    requiresReboot:  parsed.requiresReboot,
  });

  return parsed;
}

module.exports = { parseCommand };
