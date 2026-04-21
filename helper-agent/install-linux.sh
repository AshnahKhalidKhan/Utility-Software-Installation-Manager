#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Installer Manager Helper Agent — Linux Installer
# ──────────────────────────────────────────────────────────────────────────────
# Usage (one-liner):
#   curl -fsSL https://it.company.com/installer-agent/install-linux.sh | sudo bash
#
# What it does:
#   1. Installs Node.js LTS via NodeSource if missing
#   2. Writes the agent to /opt/installer-manager-agent/
#   3. Creates a systemd service that starts on boot
#   4. Opens TCP port 7334 (via ufw or iptables)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

AGENT_VERSION="1.0.0"
AGENT_PORT="${AGENT_PORT:-7334}"
INSTALL_DIR="/opt/installer-manager-agent"
SERVICE_NAME="installer-manager-agent"
DOWNLOAD_BASE="${AGENT_DOWNLOAD_URL:-https://it.company.com/installer-agent}"

# Generate a secret if none provided
if [[ -z "${AGENT_SECRET:-}" ]]; then
  AGENT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid | tr -d '-')
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

step()  { echo -e "${CYAN}  ▶ $*${NC}"; }
ok()    { echo -e "${GREEN}  ✔ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
die()   { echo -e "${RED}  ✘ $*${NC}" >&2; exit 1; }

echo -e "${YELLOW}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installer Manager Helper Agent — Linux Installer   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Version : $AGENT_VERSION"
echo "  Port    : $AGENT_PORT"
echo ""

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Must be run as root: sudo bash install-linux.sh"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
step "Checking Node.js..."
if ! command -v node &>/dev/null; then
  step "Installing Node.js LTS via NodeSource..."
  if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
    yum install -y nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
    dnf install -y nodejs
  else
    die "Unsupported package manager — install Node.js 18+ manually and re-run."
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

# ── 5. systemd service ────────────────────────────────────────────────────────
step "Creating systemd service..."

NODE_BIN=$(which node)

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Installer Manager Helper Agent
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NODE_BIN} agent.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable  "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
ok "systemd service: $(systemctl is-active "$SERVICE_NAME")"

# ── 6. Firewall ───────────────────────────────────────────────────────────────
step "Opening port $AGENT_PORT..."
if command -v ufw &>/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow "${AGENT_PORT}/tcp" comment "Installer Manager Agent" &>/dev/null
  ok "ufw rule added"
elif command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port="${AGENT_PORT}/tcp" &>/dev/null
  firewall-cmd --reload &>/dev/null
  ok "firewalld rule added"
elif command -v iptables &>/dev/null; then
  iptables -C INPUT -p tcp --dport "$AGENT_PORT" -j ACCEPT 2>/dev/null || \
    iptables -A INPUT -p tcp --dport "$AGENT_PORT" -j ACCEPT
  ok "iptables rule added"
else
  warn "Could not detect firewall manager — open port $AGENT_PORT manually if needed."
fi

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
