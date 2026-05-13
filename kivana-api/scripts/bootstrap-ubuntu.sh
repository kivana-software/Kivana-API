#!/usr/bin/env bash
# Bootstraps a fresh Ubuntu host to run Kivana via Docker.
#
# What this script does:
# - Installs Docker + compose plugin (official Docker APT repo).
# - Clones (or updates) the Kivana-API repository into BASE_DIR.
# - Creates `.env` from `.env.example` if missing.
# - Builds and starts the stack via `docker compose up -d --build`.
# - Performs a basic health check against `/healthz`.
#
# Environment variables:
# - REPO_URL: Git repo to clone (defaults to official GitHub URL).
# - BASE_DIR: install directory (default: /opt/kivana).
# - REPO_DIR: override repository directory (optional).

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kivana-software/Kivana-API.git}"
BASE_DIR="${BASE_DIR:-/opt/kivana}"
if [ -z "${REPO_DIR+x}" ]; then
  if [ -d "$BASE_DIR/Kivana-API/.git" ]; then
    REPO_DIR="$BASE_DIR/Kivana-API"
  elif [ -d "$BASE_DIR/Kivana-server/.git" ]; then
    REPO_DIR="$BASE_DIR/Kivana-server"
  else
    REPO_DIR="$BASE_DIR/Kivana-API"
  fi
fi
API_DIR="$REPO_DIR/kivana-api"

apt-get update -y
apt-get install -y ca-certificates curl git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME}) stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

mkdir -p "$BASE_DIR"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
current_origin="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$current_origin" ]; then
  git remote add origin "$REPO_URL"
elif [ "$current_origin" != "$REPO_URL" ]; then
  git remote set-url origin "$REPO_URL"
fi

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

cd "$API_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
fi

docker compose up -d --build
curl -fsS http://localhost:8080/healthz >/dev/null
echo "OK"
