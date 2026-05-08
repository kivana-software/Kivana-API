# Kivana Server (kivana-api)

## Quick Deploy (fresh Ubuntu)

## Guided Setup (Recommended)

After a fresh server install, run:

```bash
sudo bash -c 'export KIVANA_ADMIN_EMAIL="kojankus@gmail.com"; curl -fsSLO https://raw.githubusercontent.com/kivana-software/Kivana-API/main/kivana-api/scripts/setup-wizard.sh; bash setup-wizard.sh --domain=kivana.eu'
```

This writes `.env`, starts Docker, waits for health, then prints the Portal/Admin URLs and can create the first admin user.

1) Install Docker + Compose:

```bash
apt-get update -y
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME}) stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2) Clone the repo:

```bash
mkdir -p /opt/kivana
cd /opt/kivana
git clone https://github.com/kivana-software/Kivana-API.git
cd Kivana-API/kivana-api
```

3) Create `.env`:

```bash
cp .env.example .env
```

Edit `.env` and set:
- `JWT_SECRET` to a long random value
- `ADMIN_TOKEN` to a long random value
- `POSTGRES_PASSWORD` to a strong password
- `KIVANA_HTTP_PORT=80` if you want URLs without `:8080`

4) Start:

```bash
docker compose up -d --build
```

5) Check health:

```bash
curl -fsS http://localhost:8080/healthz && echo
```

## URLs

- If `KIVANA_HTTP_PORT=80`:
  - API: `http://SERVER_IP/`
  - Admin UI: `http://SERVER_IP/admin/`
  - Portal UI: `http://SERVER_IP/portal/`

- If `KIVANA_HTTP_PORT=8080`:
  - API: `http://SERVER_IP:8080/`
  - Admin UI: `http://SERVER_IP:8080/admin/`
  - Portal UI: `http://SERVER_IP:8080/portal/`

## Admin Bootstrap

If `ADMIN_TOKEN` is set, you can bootstrap an admin user:

```bash
curl -fsS -X POST \
  -H "content-type: application/json" \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -d '{"email":"you@example.com"}' \
  http://SERVER_IP:8080/v1/admin/bootstrap
```

## Update (pull + rebuild)

```bash
cd /opt/kivana/Kivana-API/kivana-api
git pull
docker compose up -d --build
```

## Troubleshooting: still seeing the old Portal

If `/portal/` still looks like the old website after an update, it’s almost always one of these:

1) You updated the wrong folder (legacy installs used `/opt/kivana/Kivana-server`).
2) The container image wasn’t rebuilt (the portal files are baked into the image).
3) Your browser cached the old static files.

### Check which repo you actually deployed

```bash
cd /opt/kivana
ls -la
cd /opt/kivana/Kivana-API 2>/dev/null || cd /opt/kivana/Kivana-server
git remote -v
```

You should see `kivana-software/Kivana-API` as the `origin` URL.

### Fix a legacy install in /opt/kivana/Kivana-server (no data wipe)

```bash
cd /opt/kivana/Kivana-server
git remote set-url origin https://github.com/kivana-software/Kivana-API.git
git fetch origin --prune
git checkout main || git checkout master
git pull --rebase
cd kivana-api
docker compose up -d --build
```

Then hard-refresh the portal page (or open in an incognito/private window):
`http://SERVER_IP/portal/`

## Portal notes

- The portal is served from the API container at `/portal/`.
- After updating, make sure you rebuilt the container (`docker compose up -d --build`), otherwise the old portal files may still be inside the running image.
- Marketing/landing mode (if you ever want it) is available at: `/portal/?marketing=1`
