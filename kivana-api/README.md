# Kivana Server (kivana-api)

## Codebase map

- `src/main.rs`: Rust/Axum HTTP server that exposes `/v1/*` APIs and serves the static UIs.
- `migrations/*.sql`: Database schema migrations applied on startup (SQLx).
- `kivana-account/`: Account portal UI served under `/account/` (plain HTML/CSS + React via esm.sh).
- `kivana-admin/`: Lightweight admin UI served under `/admin/` (plain HTML/CSS/JS).
- `kivana-portal/`: Marketing/portal UI served under `/portal/` (plain HTML/CSS/JS).
- `kivana-site/`: Production website build served at `/` (includes `static/` build artifacts).
- `downloads/`: Runtime storage for uploaded installers/binaries (mounted as a volume in docker-compose).
- `scripts/*.sh`: Deployment/bootstrap helper scripts.

## Generated assets (build artifacts)

- `kivana-site/static/**/*.js` and `kivana-site/static/**/*.css` are minified build outputs referenced by the website HTML.
- `kivana-site/static/**/*.map` and `kivana-site/asset-manifest.json` are JSON build outputs (sourcemaps/manifests) and must remain valid JSON (no inline comments).
- `*.png` files are binary image assets (logos/screenshots) and cannot safely carry embedded “comments”; their purpose is described by filename and usage locations.

## Architecture overview

Kivana is deployed as a single HTTP server + a Postgres database:

- **API server (this repo, Rust/Axum)**:
  - Serves JSON APIs under `/v1/*`.
  - Serves static UIs:
    - Website build at `/` (from `kivana-site/`)
    - Portal landing at `/portal/` (from `kivana-portal/`)
    - Account portal at `/account/` (from `kivana-account/`)
    - Admin UI at `/admin/` (from `kivana-admin/`)
  - Serves admin-uploaded binaries under `/downloads/` (volume-mounted in docker-compose).
  - Runs SQL migrations automatically on startup (from `migrations/`).

- **Database (Postgres)**:
  - Stores users, sessions (refresh tokens), plans/subscriptions, and support/contact messages.

The canonical “entrypoint” for understanding request routing and behavior is:
- `src/main.rs` (router wiring + handler implementations)

## API overview (high level)

This is a practical map of what the frontends call. Exact route list is in `src/main.rs`.

- **Health**
  - `GET /healthz` basic liveness check.

- **Captcha**
  - `GET /v1/captcha/challenge` returns `{ question, token }` used on login/signup.

- **Authentication**
  - `POST /v1/auth/signup` creates user and returns `{ accessToken, refreshToken }`.
  - `POST /v1/auth/login` verifies password and returns `{ accessToken, refreshToken }`.
  - `POST /v1/auth/refresh` rotates refresh token and returns new `{ accessToken, refreshToken }`.
  - `POST /v1/auth/logout` invalidates a single refresh token.
  - `POST /v1/auth/logout-all` invalidates all refresh tokens (all sessions).
  - `POST /v1/auth/change-password` changes password and returns new tokens.

- **Account / profile / sessions**
  - `GET /v1/me` returns the current user profile.
  - `POST /v1/profile` updates profile metadata (display name, etc.).
  - `GET /v1/sessions` lists active sessions with IP/user-agent metadata.
  - `POST /v1/sessions/:id/revoke` revokes one session.
  - `GET /v1/account/export` exports server-side account metadata as JSON.
  - `POST /v1/account/delete` deletes the account (server-side identity/subscription/support data).

- **Entitlements / billing**
  - `GET /v1/entitlements` returns product entitlements for the signed-in user.
  - `GET /v1/public/config` public portal config (pricing, downloads, feature flags).
  - `POST /v1/portal/select-plan` sets a plan directly (used for non-PayPal flows).

- **PayPal subscriptions**
  - `POST /v1/portal/paypal/start` creates a provider subscription and returns an approval URL.
  - `POST /v1/portal/paypal/confirm` confirms/links a provider subscription to local entitlements.
  - `POST /v1/paypal/webhook` receives provider events and updates subscription state.

- **Support**
  - `GET /v1/support/threads` lists the current user’s support threads.
  - `GET /v1/support/threads/:id` loads one thread + its messages.
  - `POST /v1/support/threads` creates a thread (first message).
  - `POST /v1/support/threads/:id/messages` posts a new message into an existing thread.
  - `GET /v1/support/unread-count` unread badge for the account portal UI.

- **Admin (requires `users.is_admin = true`)**
  - `POST /v1/admin/bootstrap` sets the first admin via `x-admin-token: ADMIN_TOKEN`.
  - `GET /v1/admin/users` lists users; additional `/v1/admin/users/:id/*` mutate roles, plan, password, discounts.
  - `GET /v1/admin/support/threads` admin support inbox; thread mutation endpoints archive/solve/delete.
  - `GET/POST /v1/admin/config` portal settings (JSON).
  - `GET/POST /v1/admin/paypal/config` PayPal credentials/config.
  - `POST /v1/admin/paypal/sync-plans` pushes/refreshes PayPal plan IDs.
  - `POST /v1/admin/paypal/webhook/create` registers a webhook at PayPal.
  - `POST /v1/admin/downloads/upload` uploads binaries into `/downloads/`.

## Data model overview

This is a “what lives where” summary. The authoritative schema is in `migrations/*.sql`.

- **users**
  - Identity: `id`, `email`, `password_hash`
  - Roles: `is_admin`, `is_moderator`, `is_founder`
  - Security: `last_ip`, `password_changed_at`, `admin_lock_ip`, `admin_lock_at`
  - Profile: `display_name`, `avatar_data_url`
  - Discounts: `discount_percent`, `discount_label`, `discount_expires_at`, `founder_discount_at`
  - Support encryption: `chat_public_jwk` (public key for E2EE)

- **sessions**
  - Refresh token sessions: `id`, `user_id`, `refresh_token_hash`, `expires_at`
  - Client metadata: `client_ip`, `user_agent`

- **products / plans / features / plan_features**
  - Catalog used by entitlements + portal display.

- **subscriptions**
  - Local subscription state per user + provider linkage (PayPal IDs/status).

- **contact_messages**
  - Legacy “contact us” messages; later migrated into support threads/messages.

- **support_threads / support_messages**
  - Threaded support system; messages can be plaintext or encrypted payload strings.

- **app_settings**
  - Admin-managed JSON key/value store for portal settings.

## Support chat encryption (E2EE)

The account portal can encrypt support messages end-to-end:

- Client generates an RSA keypair (RSA-OAEP SHA-256).
- The private key is stored only on the client device (wrapped with a device-local AES secret in localStorage).
- The public key (JWK) is uploaded to the server so admins can encrypt replies to that user.
- Each message uses a random AES-GCM key to encrypt content; the AES key is encrypted per recipient using RSA-OAEP.

Implementation details are documented inline in:
- `kivana-account/app.js` (search for “E2EE” and “Support chat”)

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
