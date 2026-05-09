#!/usr/bin/env bash
set -euo pipefail

C_BLUE='\033[1;34m'
C_CYAN='\033[1;36m'
C_GREEN='\033[1;32m'
C_PURPLE='\033[1;35m'
C_YELLOW='\033[1;33m'
C_RED='\033[1;31m'
C_RESET='\033[0m'
C_BOLD='\033[1m'

info() { echo -e "${C_CYAN}[i]${C_RESET} $1"; }
success() { echo -e "${C_GREEN}[✓]${C_RESET} $1"; }
error() { echo -e "${C_RED}[✗]${C_RESET} $1"; }
warn() { echo -e "${C_YELLOW}[!]${C_RESET} $1"; }

REPO_URL_DEFAULT="https://github.com/kivana-software/Kivana-API.git"
BASE_DIR_DEFAULT="/opt/kivana"
REPO_DIR_DEFAULT="${BASE_DIR_DEFAULT}/Kivana-API"
API_DIR_DEFAULT="${REPO_DIR_DEFAULT}/kivana-api"
DOMAIN_NAME_DEFAULT="kivana.eu"

REPO_URL="$REPO_URL_DEFAULT"
BASE_DIR="$BASE_DIR_DEFAULT"
HTTP_PORT="8080"
KIVANA_BIND_IP="0.0.0.0"
DOMAIN_NAME="$DOMAIN_NAME_DEFAULT"
HTTPS_EMAIL=""
ENABLE_HTTPS="n"
FORCE_NO_HTTPS="n"
POSTGRES_PASSWORD=""
JWT_SECRET=""
ADMIN_TOKEN=""
INTERACTIVE="n"
ADMIN_EMAIL="${KIVANA_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${KIVANA_ADMIN_PASSWORD:-}"
LOCAL_MODE="n"

for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_MODE="y" ;;
    --interactive) INTERACTIVE="y" ;;
    --domain=*) DOMAIN_NAME="${arg#*=}" ;;
    --email=*) HTTPS_EMAIL="${arg#*=}" ;;
    --base-dir=*) BASE_DIR="${arg#*=}" ;;
    --repo=*) REPO_URL="${arg#*=}" ;;
    --http-port=*) HTTP_PORT="${arg#*=}" ;;
    --no-https) ENABLE_HTTPS="n"; FORCE_NO_HTTPS="y" ;;
    --admin-email=*) ADMIN_EMAIL="${arg#*=}" ;;
    --admin-password=*) ADMIN_PASSWORD="${arg#*=}" ;;
  esac
done

if [ "$LOCAL_MODE" != "y" ] && [ "${EUID:-0}" -ne 0 ]; then
  error "Run as root: sudo -i"
  exit 1
fi

prompt() {
  local label="${C_PURPLE}[?]${C_RESET} $1"
  local def="${2:-}"
  local v
  if [ -n "$def" ]; then
    if [ -r /dev/tty ]; then
      read -r -p "$(echo -e "${label} [${C_BOLD}${def}${C_RESET}]: ")" v </dev/tty || v=""
    else
      read -r -p "$(echo -e "${label} [${C_BOLD}${def}${C_RESET}]: ")" v || v=""
    fi
    if [ -z "$v" ]; then v="$def"; fi
  else
    if [ -r /dev/tty ]; then
      read -r -p "$(echo -e "${label}: ")" v </dev/tty || v=""
    else
      read -r -p "$(echo -e "${label}: ")" v || v=""
    fi
  fi
  printf "%s" "$v"
}

confirm() {
  local label="${C_PURPLE}[?]${C_RESET} $1"
  local def="${2:-y}"
  local v
  while true; do
    if [ "$def" = "y" ]; then
      if [ -r /dev/tty ]; then
        read -r -p "$(echo -e "${label} [${C_BOLD}Y${C_RESET}/n]: ")" v </dev/tty || v=""
      else
        read -r -p "$(echo -e "${label} [${C_BOLD}Y${C_RESET}/n]: ")" v || v=""
      fi
      v="${v:-y}"
    else
      if [ -r /dev/tty ]; then
        read -r -p "$(echo -e "${label} [y/${C_BOLD}N${C_RESET}]: ")" v </dev/tty || v=""
      else
        read -r -p "$(echo -e "${label} [y/${C_BOLD}N${C_RESET}]: ")" v || v=""
      fi
      v="${v:-n}"
    fi
    case "$v" in
      y|Y) return 0 ;;
      n|N) return 1 ;;
    esac
  done
}

rand_hex() {
  local nbytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$nbytes"
  else
    head -c "$nbytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

prompt_secret() {
  local label="${C_PURPLE}[?]${C_RESET} $1"
  local v
  if [ -r /dev/tty ]; then
    read -r -s -p "$(echo -e "${label}: ")" v </dev/tty || v=""
    echo >/dev/tty || true
  else
    read -r -s -p "$(echo -e "${label}: ")" v || v=""
    echo || true
  fi
  printf "%s" "$v"
}

banner() {
  echo -e "${C_CYAN}${C_BOLD}"
  cat <<'EOF'
 _  ___                     
| |/ (_)_   ____ _ _ __ ___ 
| ' /| \ \ / / _` | '_ ` _ \
| . \| |\ V / (_| | | | | | |
|_|\_\_| \_/ \__,_|_| |_| |_|
EOF
  echo -e "${C_RESET}"
  echo -e " ${C_BOLD}Kivana API Server Setup${C_RESET} ${C_PURPLE}v0.2.6${C_RESET}"
  echo -e " ${C_YELLOW}Auto install: Docker + Postgres + HTTPS (Caddy)${C_RESET}"
  echo
}

banner

run_local_mode() {
  local script_dir api_dir env_file compose_cmd base_url
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  api_dir="$(cd "${script_dir}/.." && pwd)"
  env_file="${api_dir}/.env"

  info "Local mode: using Docker Compose in ${api_dir}"

  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found."
    if command -v brew >/dev/null 2>&1 && [ "$(uname -s)" = "Darwin" ]; then
      warn "Trying to install Docker Desktop via Homebrew..."
      brew install --cask docker || true
      open -a Docker || true
    fi
  fi

  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is required. Install Docker Desktop, start it, then re-run: ./scripts/setup-wizard.sh --local"
    exit 1
  fi

  if docker compose version >/dev/null 2>&1; then
    compose_cmd="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    compose_cmd="docker-compose"
  else
    error "Docker Compose not found. Install Docker Compose (or Docker Desktop) and re-run."
    exit 1
  fi

  if [ -z "$POSTGRES_PASSWORD" ]; then
    POSTGRES_PASSWORD="$(rand_hex 24)"
    success "Generated Postgres password."
  fi
  if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET="$(rand_hex 48)"
    success "Generated JWT secret."
  fi
  if [ -z "$ADMIN_TOKEN" ]; then
    ADMIN_TOKEN="$(rand_hex 24)"
    success "Generated admin token."
  fi
  if [ -z "$DOMAIN_NAME" ]; then
    DOMAIN_NAME="localhost"
  fi
  if [ -z "$HTTP_PORT" ]; then
    HTTP_PORT="8080"
  fi

  info "Writing ${env_file}"
  cat > "${env_file}" <<EOF
DATABASE_URL=postgres://kivana:${POSTGRES_PASSWORD}@db:5432/kivana
JWT_SECRET=${JWT_SECRET}
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
BIND_ADDR=0.0.0.0:8080
ADMIN_TOKEN=${ADMIN_TOKEN}
RUST_LOG=info
KIVANA_HTTP_PORT=${HTTP_PORT}
KIVANA_BIND_IP=127.0.0.1
KIVANA_DOMAIN=${DOMAIN_NAME}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
EOF

  info "Starting services with Docker Compose..."
  (cd "${api_dir}" && ${compose_cmd} up -d --build)

  base_url="http://localhost:${HTTP_PORT}"
  info "Waiting for API health: ${base_url}/healthz"
  for _ in $(seq 1 60); do
    if curl -fsS "${base_url}/healthz" >/dev/null 2>&1; then
      success "API is up: ${base_url}"
      break
    fi
    sleep 2
  done

  if ! curl -fsS "${base_url}/healthz" >/dev/null 2>&1; then
    warn "API did not become healthy yet. Check logs with: (cd ${api_dir} && ${compose_cmd} logs -f api)"
  fi

  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    info "Creating admin user: ${ADMIN_EMAIL}"
    curl -fsS -X POST "${base_url}/v1/auth/signup" \
      -H "content-type: application/json" \
      -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" >/dev/null 2>&1 || true
    curl -fsS -X POST "${base_url}/v1/admin/bootstrap" \
      -H "x-admin-token: ${ADMIN_TOKEN}" \
      -H "content-type: application/json" \
      -d "{\"email\":\"${ADMIN_EMAIL}\"}" >/dev/null 2>&1 || true
    success "Admin bootstrap attempted. Sign in at: ${base_url}/portal/"
  else
    warn "To auto-create an admin, re-run with: --admin-email=YOU --admin-password=STRONGPASS"
  fi

  success "Website: ${base_url}/"
  success "Portal:   ${base_url}/portal/"
  exit 0
}

if [ "$LOCAL_MODE" = "y" ]; then
  run_local_mode
fi

APT_UPDATED="n"
apt_update_once() {
  if [ "$APT_UPDATED" = "y" ]; then return 0; fi
  if ! command -v apt-get >/dev/null 2>&1; then
    error "apt-get not found. This wizard currently supports Debian/Ubuntu servers."
    exit 1
  fi
  info "Step 1/6: Preparing system packages..."
  apt-get update -y
  apt-get install -y ca-certificates curl
  APT_UPDATED="y"
}

apt_install() {
  apt_update_once
  apt-get install -y "$@"
}

set_env_key() {
  local key="$1"
  local value="$2"
  local file="$3"
  if [ -f "$file" ] && grep -qE "^${key}=" "$file"; then
    sed -i -E "s|^${key}=.*|${key}=${value}|g" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

if [ "$INTERACTIVE" = "y" ]; then
  info "Starting interactive setup..."
  BASE_DIR="$(prompt "Install base dir" "$BASE_DIR")"
  DOMAIN_NAME="$(prompt "Public domain name for HTTPS" "$DOMAIN_NAME")"
  if confirm "Enable HTTPS (Let's Encrypt) for ${DOMAIN_NAME} using Caddy?" y; then
    ENABLE_HTTPS="y"
  else
    ENABLE_HTTPS="n"
  fi
  if [ -z "$ADMIN_EMAIL" ]; then
    ADMIN_EMAIL="$(prompt "Admin email (optional, leave blank to skip)" "")"
  fi
else
  info "Auto mode: minimal prompts, safe updates."
  if [ -n "${KIVANA_DOMAIN:-}" ]; then DOMAIN_NAME="$KIVANA_DOMAIN"; fi
  if [ -z "$DOMAIN_NAME" ]; then DOMAIN_NAME="$DOMAIN_NAME_DEFAULT"; fi
  if [ -n "${KIVANA_ENABLE_HTTPS:-}" ]; then
    v="$(echo "${KIVANA_ENABLE_HTTPS}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
    if [ "$v" = "1" ] || [ "$v" = "true" ] || [ "$v" = "y" ] || [ "$v" = "yes" ]; then
      ENABLE_HTTPS="y"
    else
      ENABLE_HTTPS="n"
    fi
  elif [ "$FORCE_NO_HTTPS" = "y" ]; then
    ENABLE_HTTPS="n"
  else
    d="$(echo "$DOMAIN_NAME" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
    if [ "$d" = "localhost" ] || [ "$d" = "127.0.0.1" ] || [ "$d" = "" ]; then
      ENABLE_HTTPS="n"
    else
      ENABLE_HTTPS="y"
    fi
  fi
fi

if [ "$ENABLE_HTTPS" = "y" ]; then
  KIVANA_BIND_IP="127.0.0.1"
fi

apt_update_once

if [ -z "$POSTGRES_PASSWORD" ]; then
  POSTGRES_PASSWORD="$(rand_hex 24)"
  success "Generated Postgres password."
fi

if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET="$(rand_hex 48)"
  success "Generated JWT secret."
fi

if [ -z "$ADMIN_TOKEN" ]; then
  ADMIN_TOKEN="$(rand_hex 24)"
  success "Generated admin token."
fi

if [ "$ENABLE_HTTPS" = "y" ]; then
  if [ "$HTTP_PORT" = "80" ] || [ "$HTTP_PORT" = "443" ]; then
    warn "Internal API port ${HTTP_PORT} conflicts with HTTPS (Caddy needs 80/443). Switching internal API port to 8080."
    HTTP_PORT="8080"
  fi
fi

if [ -d "${BASE_DIR}/Kivana-API/.git" ]; then
  REPO_DIR="${BASE_DIR}/Kivana-API"
elif [ -d "${BASE_DIR}/Kivana-server/.git" ]; then
  REPO_DIR="${BASE_DIR}/Kivana-server"
  warn "Found legacy install dir: ${REPO_DIR}"
  warn "Reusing it, but will retarget 'origin' to: ${REPO_URL}"
else
  REPO_DIR="${BASE_DIR}/Kivana-API"
fi
API_DIR="${REPO_DIR}/kivana-api"

if ! command -v git >/dev/null 2>&1; then
  info "Step 2/6: Installing prerequisites (git)..."
  apt_install git
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found. Installing Docker + Compose..."
  info "Step 3/6: Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME}) stable" > /etc/apt/sources.list.d/docker.list
  apt_update_once
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  success "Docker installed."
fi

mkdir -p "$BASE_DIR"
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  info "Step 4/6: Updating repo..."
  current_origin="$(git remote get-url origin 2>/dev/null || true)"
  if [ -z "$current_origin" ]; then
    git remote add origin "$REPO_URL"
  elif [ "$current_origin" != "$REPO_URL" ]; then
    warn "Updating origin remote:"
    warn "  from: ${current_origin}"
    warn "    to: ${REPO_URL}"
    git remote set-url origin "$REPO_URL"
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Local changes detected. Skipping git pull to avoid overwriting changes."
  else
    git fetch origin --prune
    BRANCH="main"
    if git show-ref --verify --quiet refs/remotes/origin/main; then
      BRANCH="main"
    elif git show-ref --verify --quiet refs/remotes/origin/master; then
      BRANCH="master"
    else
      BRANCH="$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' | tail -n1)"
      BRANCH="${BRANCH:-main}"
    fi

    if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
      git checkout "$BRANCH" >/dev/null 2>&1
    else
      git checkout -b "$BRANCH" "origin/$BRANCH" >/dev/null 2>&1 || git checkout "$BRANCH" >/dev/null 2>&1
    fi

    git pull --rebase origin "$BRANCH"
    success "Repo updated."
  fi
else
  info "Step 4/6: Cloning repo..."
  info "Cloning repo..."
  git clone "$REPO_URL" "$REPO_DIR"
  success "Cloned."
fi

cd "$API_DIR"

info "Step 5/6: Configuring environment (.env)..."
OVERWRITE_ENV="y"
if [ -f .env ]; then
  OVERWRITE_ENV="n"
  if [ "$INTERACTIVE" = "y" ] && confirm ".env exists. Overwrite it? (recommended only on fresh server)" n; then
    OVERWRITE_ENV="y"
  fi
  if [ "$OVERWRITE_ENV" != "y" ]; then
    warn "Keeping existing .env (will update only missing/required keys)."
  fi
fi

if [ "$OVERWRITE_ENV" = "y" ]; then
  cat > .env <<EOF
DATABASE_URL=postgres://kivana:${POSTGRES_PASSWORD}@db:5432/kivana
JWT_SECRET=${JWT_SECRET}
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
BIND_ADDR=0.0.0.0:8080
ADMIN_TOKEN=${ADMIN_TOKEN}
RUST_LOG=info
KIVANA_HTTP_PORT=${HTTP_PORT}
KIVANA_BIND_IP=${KIVANA_BIND_IP}
KIVANA_DOMAIN=${DOMAIN_NAME}
KIVANA_ENABLE_HTTPS=${ENABLE_HTTPS}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
EOF
  chmod 600 .env || true
  success ".env written"
else
  if ! grep -qE '^POSTGRES_PASSWORD=' .env; then set_env_key "POSTGRES_PASSWORD" "${POSTGRES_PASSWORD}" ".env"; fi
  if ! grep -qE '^JWT_SECRET=' .env; then set_env_key "JWT_SECRET" "${JWT_SECRET}" ".env"; fi
  if ! grep -qE '^ADMIN_TOKEN=' .env; then set_env_key "ADMIN_TOKEN" "${ADMIN_TOKEN}" ".env"; fi
  set_env_key "KIVANA_HTTP_PORT" "${HTTP_PORT}" ".env"
  set_env_key "KIVANA_BIND_IP" "${KIVANA_BIND_IP}" ".env"
  set_env_key "KIVANA_DOMAIN" "${DOMAIN_NAME}" ".env"
  set_env_key "KIVANA_ENABLE_HTTPS" "${ENABLE_HTTPS}" ".env"
  success ".env updated"
fi

echo
info "Step 6/6: Starting containers..."
docker compose up -d --build

info "Waiting for health..."
ok="n"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${HTTP_PORT}/healthz" >/dev/null 2>&1; then
    ok="y"
    break
  fi
  sleep 1
done

if [ "$ok" != "y" ]; then
  error "Health check did not pass yet. Showing logs:"
  docker compose logs --tail=200 api || true
  if docker compose logs --tail=200 api 2>/dev/null | grep -qi "password authentication failed for user"; then
    warn "Detected Postgres password mismatch between API and DB."
    if [ "$INTERACTIVE" = "y" ] && confirm "Fix by resetting DB password to match .env (recommended)?" y; then
      if docker compose exec -T db psql -U postgres -d postgres -c "ALTER USER kivana WITH PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null 2>&1; then
        success "DB password updated."
        docker compose restart api >/dev/null 2>&1 || true
        info "Waiting for health (retry)..."
        for _ in $(seq 1 60); do
          if curl -fsS "http://localhost:${HTTP_PORT}/healthz" >/dev/null 2>&1; then
            ok="y"
            break
          fi
          sleep 1
        done
        if [ "$ok" != "y" ]; then
          error "Still not healthy after password reset. Showing logs:"
          docker compose logs --tail=200 api || true
          exit 1
        fi
      else
        error "Could not update DB password automatically."
        info "Alternative fix (wipes DB): cd $API_DIR && docker compose down -v && docker compose up -d --build"
        exit 1
      fi
    else
      if [ "$INTERACTIVE" != "y" ]; then
        error "Auto mode will not reset DB passwords. Fix by ensuring your .env matches your DB, or wipe volumes if it's a fresh server."
      fi
      info "Fix option (wipes DB): cd $API_DIR && docker compose down -v && docker compose up -d --build"
      exit 1
    fi
  else
    exit 1
  fi
fi
success "Server is healthy!"

setup_caddy_https() {
  local domain="$1"
  local upstream_port="$2"
  local email="${3:-}"
  local root_domain="$domain"
  local www_domain=""
  local dot_count=""

  if [ -z "$domain" ]; then
    return 0
  fi
  domain="$(echo "$domain" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  root_domain="$domain"
  if [[ "$domain" == www.* ]]; then
    root_domain="${domain#www.}"
  fi
  dot_count="$(echo "$root_domain" | awk -F'.' '{print NF-1}')"
  if [ "$dot_count" = "1" ]; then
    www_domain="www.${root_domain}"
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not found. Skipping HTTPS setup."
    return 0
  fi

  if ! command -v caddy >/dev/null 2>&1; then
    info "Installing Caddy (HTTPS reverse proxy)..."
    apt_install debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt_update_once
    apt-get update -y
    apt-get install -y caddy
    success "Caddy installed."
  fi

  mkdir -p /etc/caddy

  if [ -f /etc/caddy/Caddyfile ]; then
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup-${ts}" || true
  fi

  info "Writing Caddyfile (HTTPS for ${root_domain})..."
  if [ -n "$email" ]; then
    cat > /etc/caddy/Caddyfile <<EOF
{
  email ${email}
}
EOF
  else
    cat > /etc/caddy/Caddyfile <<EOF
EOF
  fi

  if [ -n "$www_domain" ]; then
    cat >> /etc/caddy/Caddyfile <<EOF

${www_domain} {
  redir https://${root_domain}{uri} permanent
}
EOF
  fi

  cat >> /etc/caddy/Caddyfile <<EOF

${root_domain} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${upstream_port}
}
EOF

  systemctl enable --now caddy >/dev/null 2>&1 || true
  if systemctl reload caddy >/dev/null 2>&1; then
    success "HTTPS enabled via Caddy."
  else
    systemctl restart caddy >/dev/null 2>&1 || true
    warn "Caddy reload failed; restarted Caddy."
    warn "If HTTPS still does not work, check logs: journalctl -u caddy -n 200 --no-pager"
  fi
}

if [ -n "$DOMAIN_NAME" ] && [ "$ENABLE_HTTPS" = "y" ]; then
  echo
  warn "HTTPS requires ports 80 and 443 reachable from the internet for Let's Encrypt."
  if command -v ufw >/dev/null 2>&1; then
    info "Allowing ports 80/443 in UFW (if enabled)..."
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi
  setup_caddy_https "$DOMAIN_NAME" "$HTTP_PORT" "$HTTPS_EMAIL"
fi

PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || true)"
fi
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="<SERVER_IP>"
fi

PORT_SUFFIX=":${HTTP_PORT}"
if [ "$HTTP_PORT" = "80" ]; then
  PORT_SUFFIX=""
fi

echo -e "\n${C_GREEN}===============================================${C_RESET}"
echo -e "${C_GREEN}✓ Setup Complete!${C_RESET}"
echo -e "${C_GREEN}===============================================${C_RESET}"
if [ -n "$DOMAIN_NAME" ] && [ "$ENABLE_HTTPS" = "y" ]; then
  d="$(echo "$DOMAIN_NAME" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  if [[ "$d" == www.* ]]; then d="${d#www.}"; fi
  echo -e "${C_BOLD}Portal:${C_RESET} ${C_BLUE}https://${d}/${C_RESET}"
  echo -e "${C_BOLD}Admin:${C_RESET}  ${C_BLUE}https://${d}/admin/${C_RESET}"
  echo -e "${C_BOLD}API:${C_RESET}    ${C_BLUE}https://${d}/healthz${C_RESET}"
else
  echo -e "${C_BOLD}Portal:${C_RESET} ${C_BLUE}http://${PUBLIC_IP}${PORT_SUFFIX}/${C_RESET}"
  echo -e "${C_BOLD}Admin:${C_RESET}  ${C_BLUE}http://${PUBLIC_IP}${PORT_SUFFIX}/admin/${C_RESET}"
  echo -e "${C_BOLD}API:${C_RESET}    ${C_BLUE}http://${PUBLIC_IP}${PORT_SUFFIX}/healthz${C_RESET}"
fi
echo
echo -e "${C_BOLD}Admin bootstrap token:${C_RESET}"
echo -e "  ${C_YELLOW}${ADMIN_TOKEN}${C_RESET}"

if [ "$INTERACTIVE" != "y" ] && [ -n "$ADMIN_EMAIL" ]; then
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(rand_hex 16)"
  fi
  if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
    error "ADMIN password must be at least 8 characters."
    exit 1
  fi

  echo
  info "Creating admin user (${ADMIN_EMAIL})..."
  signup_code="$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "content-type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    "http://localhost:${HTTP_PORT}/v1/auth/signup" || true)"

  if [ "$signup_code" = "200" ] || [ "$signup_code" = "409" ]; then
    success "User account exists."
  else
    error "Signup failed (HTTP ${signup_code})."
    exit 1
  fi

  if curl -fsS -X POST \
    -H "content-type: application/json" \
    -H "x-admin-token: ${ADMIN_TOKEN}" \
    -d "{\"email\":\"${ADMIN_EMAIL}\"}" \
    "http://localhost:${HTTP_PORT}/v1/admin/bootstrap" > /dev/null; then
    success "Admin created successfully!"
    echo
    echo -e "${C_BOLD}Admin login:${C_RESET}"
    echo -e "  Email:    ${C_YELLOW}${ADMIN_EMAIL}${C_RESET}"
    echo -e "  Password: ${C_YELLOW}${ADMIN_PASSWORD}${C_RESET}"
  else
    error "Failed to create admin."
    exit 1
  fi
fi

echo -e "${C_GREEN}===============================================${C_RESET}\n"

if [ "$INTERACTIVE" = "y" ] && confirm "Create first admin user now?" n; then
  ADMIN_EMAIL="$(prompt "Admin email" "")"
  if [ -n "$ADMIN_EMAIL" ]; then
    info "Bootstrapping admin user..."
    if curl -fsS -X POST \
      -H "content-type: application/json" \
      -H "x-admin-token: ${ADMIN_TOKEN}" \
      -d "{\"email\":\"${ADMIN_EMAIL}\"}" \
      "http://localhost:${HTTP_PORT}/v1/admin/bootstrap" > /dev/null; then
      success "Admin created successfully!"
    else
      warn "Bootstrap failed (often because the user account doesn't exist yet)."
      if [ -r /dev/tty ] && confirm "Create the user account now (signup) and retry?" y; then
        ADMIN_PASSWORD="$(prompt_secret "Admin password (min 8 chars, not shown)")"
        if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
          error "Password must be at least 8 characters."
          exit 1
        fi

        info "Creating user account..."
        signup_code="$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
          -H "content-type: application/json" \
          -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
          "http://localhost:${HTTP_PORT}/v1/auth/signup" || true)"

        if [ "$signup_code" = "200" ] || [ "$signup_code" = "409" ]; then
          success "User account exists."
        else
          error "Signup failed (HTTP ${signup_code})."
          exit 1
        fi

        info "Retrying admin bootstrap..."
        if curl -fsS -X POST \
          -H "content-type: application/json" \
          -H "x-admin-token: ${ADMIN_TOKEN}" \
          -d "{\"email\":\"${ADMIN_EMAIL}\"}" \
          "http://localhost:${HTTP_PORT}/v1/admin/bootstrap" > /dev/null; then
          success "Admin created successfully!"
        else
          error "Failed to create admin."
          exit 1
        fi
      else
        error "Failed to create admin."
        info "Fix: sign up that email in the Portal first, then rerun bootstrap."
      fi
    fi
  fi
fi
