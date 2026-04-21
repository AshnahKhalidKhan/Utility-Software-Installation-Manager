#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Installer Manager Helper Agent — macOS Installer
# ──────────────────────────────────────────────────────────────────────────────
# Usage (one-liner):
#   curl -fsSL https://it.company.com/installer-agent/install-macos.sh | sudo bash
#
# What it does:
#   1. Installs Node.js LTS (via Homebrew, or official .pkg if brew absent)
#   2. Writes the agent to /usr/local/lib/installer-manager-agent/
#   3. Installs a launchd daemon that starts on boot
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

AGENT_VERSION="1.0.0"
AGENT_PORT="${AGENT_PORT:-7334}"
INSTALL_DIR="/usr/local/lib/installer-manager-agent"
SERVICE_LABEL="com.company.installer-manager-agent"
PLIST_PATH="/Library/LaunchDaemons/${SERVICE_LABEL}.plist"
DOWNLOAD_BASE="${AGENT_DOWNLOAD_URL:-https://it.company.com/installer-agent}"
NODE_PKG_VERSION="20.11.0"

if [[ -z "${AGENT_SECRET:-}" ]]; then
  AGENT_SECRET=$(openssl rand -hex 32 2>/dev/null || uuidgen | tr -d '-' | tr '[:upper:]' '[:lower:]')
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

step() { echo -e "${CYAN}  ▶ $*${NC}"; }
ok()   { echo -e "${GREEN}  ✔ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
die()  { echo -e "${RED}  ✘ $*${NC}" >&2; exit 1; }

echo -e "${YELLOW}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installer Manager Helper Agent — macOS Installer   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Version : $AGENT_VERSION"
echo "  Port    : $AGENT_PORT"
echo ""

[[ $EUID -eq 0 ]] || die "Must be run as root: sudo bash install-macos.sh"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
step "Checking Node.js..."
if ! command -v node &>/dev/null; then
  if command -v brew &>/dev/null; then
    step "Installing Node.js via Homebrew..."
    # brew must run as the actual user, not root
    ACTUAL_USER=$(logname 2>/dev/null || stat -f '%Su' /dev/console)
    sudo -u "$ACTUAL_USER" brew install node
  else
    step "Downloading Node.js v${NODE_PKG_VERSION} .pkg installer..."
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" ]]; then
      PKG_URL="https://nodejs.org/dist/v${NODE_PKG_VERSION}/node-v${NODE_PKG_VERSION}-darwin-arm64.pkg"
    else
      PKG_URL="https://nodejs.org/dist/v${NODE_PKG_VERSION}/node-v${NODE_PKG_VERSION}-darwin-x64.pkg"
    fi
    curl -fsSL "$PKG_URL" -o "/tmp/node-installer.pkg"
    installer -pkg /tmp/node-installer.pkg -target /
    rm -f /tmp/node-installer.pkg
  fi
fi
ok "Node.js $(node --version)"

# ── 2. Install directory ──────────────────────────────────────────────────────
step "Creating $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
ok "$INSTALL_DIR ready"

# ── 3. Download agent.js ──────────────────────────────────────────────────────
step "Downloading agent..."
if curl -fsSL "$DOWNLOAD_BASE/helper-agent/agent.js" -o "$INSTALL_DIR/agent.js" 2>/dev/null; then
  ok "agent.js downloaded"
else
  warn "Download failed — writing bundled placeholder."
  cat > "$INSTALL_DIR/agent.js" <<'PLACEHOLDER'
// BUNDLED AGENT PLACEHOLDER
// Replace this file with the real agent.js content before deploying.
console.error("Bundled agent placeholder. Download the real agent.js.");
process.exit(1);
PLACEHOLDER
fi

# ── 4. Write .env ─────────────────────────────────────────────────────────────
step "Writing configuration..."
cat > "$INSTALL_DIR/.env" <<EOF
AGENT_PORT=$AGENT_PORT
AGENT_SECRET=$AGENT_SECRET
EOF
chmod 600 "$INSTALL_DIR/.env"
ok ".env written"

echo ""
echo -e "${YELLOW}${BOLD}  ┌────────────────────────────────────────────────────┐"
echo    "  │  Agent Secret: $AGENT_SECRET"
echo    "  │  Add to backend .env as: HELPER_AGENT_SECRET"
echo -e "  └────────────────────────────────────────────────────┘${NC}"
echo ""

# ── 5. launchd daemon ─────────────────────────────────────────────────────────
step "Installing launchd daemon..."

# Unload any existing daemon
if launchctl list | grep -q "$SERVICE_LABEL" 2>/dev/null; then
  warn "Removing existing daemon..."
  launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
fi

NODE_BIN=$(which node)

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_DIR}/agent.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_PORT</key>   <string>${AGENT_PORT}</string>
    <key>AGENT_SECRET</key> <string>${AGENT_SECRET}</string>
  </dict>

  <key>RunAtLoad</key>   <true/>
  <key>KeepAlive</key>   <true/>
  <key>ThrottleInterval</key> <integer>10</integer>

  <key>StandardOutPath</key>
  <string>/var/log/installer-manager-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/installer-manager-agent-error.log</string>
</dict>
</plist>
EOF

launchctl bootstrap system "$PLIST_PATH"
sleep 2
STATUS=$(launchctl list | grep "$SERVICE_LABEL" || echo "not listed")
ok "launchd daemon: $STATUS"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════╗"
echo "║   Installation complete!             ║"
echo "║   Agent listening on port $AGENT_PORT       ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"
echo "  You can now retry your original request in Microsoft Teams."
echo ""
