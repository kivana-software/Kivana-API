use anyhow::Context;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, FromRef, OriginalUri, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::response::Redirect;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::time::{Duration as StdDuration, Instant};
use time::{Duration, OffsetDateTime};
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::Level;
use uuid::Uuid;

#[derive(Clone)]
struct AppConfig {
    database_url: String,
    jwt_secret: String,
    access_token_ttl_seconds: i64,
    refresh_token_ttl_days: i64,
    bind_addr: SocketAddr,
}

#[derive(Clone)]
struct RateLimiter {
    inner: std::sync::Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            inner: std::sync::Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn allow(&self, key: String, window: StdDuration, max: usize) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().await;
        let q = map.entry(key).or_insert_with(VecDeque::new);
        while let Some(t) = q.front().copied() {
            if now.duration_since(t) > window {
                q.pop_front();
            } else {
                break;
            }
        }
        if q.len() >= max {
            return false;
        }
        q.push_back(now);
        true
    }
}

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    jwt: JwtKeys,
    cfg: AppConfig,
    tx_events: broadcast::Sender<UserEvent>,
    rate_limiter: RateLimiter,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserEvent {
    user_id: String,
    event_type: String,
}

#[derive(Clone)]
struct JwtKeys {
    enc: EncodingKey,
    dec: DecodingKey,
}

impl FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

#[derive(Serialize, Deserialize)]
struct AccessClaims {
    sub: String,
    email: String,
    exp: usize,
    iat: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignupRequest {
    email: String,
    password: String,
    captcha_token: Option<String>,
    captcha_answer: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
    email: String,
    password: String,
    captcha_token: Option<String>,
    captcha_answer: Option<String>,
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Deserialize)]
struct LogoutRequest {
    refresh_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContactRequest {
    name: String,
    email: String,
    subject: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminContactMessagesResponse {
    messages: Vec<AdminContactMessageRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminContactMessageRow {
    id: String,
    created_at: String,
    name: String,
    email: String,
    subject: Option<String>,
    message: String,
    client_ip: Option<String>,
    is_read: bool,
    read_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportCreateThreadRequest {
    subject: Option<String>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportSendMessageRequest {
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPublicKeyRequest {
    public_jwk: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicKeyResponse {
    public_jwk: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminKeysResponse {
    admins: Vec<AdminKeyRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminKeyRow {
    id: String,
    public_jwk: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnreadCountResponse {
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportThreadsResponse {
    threads: Vec<SupportThreadSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportThreadSummary {
    id: String,
    subject: String,
    status: String,
    last_message_at: String,
    last_sender_role: String,
    has_unread: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportThreadResponse {
    thread: SupportThreadDetail,
    messages: Vec<SupportMessageRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportThreadDetail {
    id: String,
    subject: String,
    status: String,
    created_at: String,
    last_message_at: String,
    last_sender_role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportMessageRow {
    id: String,
    sender_role: String,
    body: String,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminSupportThreadsResponse {
    threads: Vec<AdminSupportThreadSummary>,
}

#[derive(Deserialize)]
struct AdminSupportThreadsQuery {
    status: Option<String>,
    q: Option<String>,
    user_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminSupportThreadSummary {
    id: String,
    subject: String,
    status: String,
    last_message_at: String,
    last_sender_role: String,
    has_unread: bool,
    user_email: String,
    user_name: String,
    user_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminSupportThreadResponse {
    thread: AdminSupportThreadDetail,
    messages: Vec<SupportMessageRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminSupportThreadDetail {
    id: String,
    subject: String,
    status: String,
    created_at: String,
    last_message_at: String,
    last_sender_role: String,
    has_unread: bool,
    user_email: String,
    user_name: String,
    user_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    user: UserInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserInfo {
    id: String,
    email: String,
    created_at: Option<String>,
    display_name: Option<String>,
    avatar_data_url: Option<String>,
    is_admin: bool,
    is_moderator: bool,
    is_founder: bool,
    discount_percent: Option<i32>,
    discount_label: Option<String>,
    discount_expires_at: Option<String>,
    password_changed_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProfileRequest {
    display_name: Option<String>,
    avatar_data_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementsResponse {
    products: Vec<ProductEntitlement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductEntitlement {
    product_code: String,
    plan_code: String,
    plan_name: String,
    status: String,
    ends_at: Option<String>,
    trial_ends_at: Option<String>,
    is_trial: bool,
    trial_eligible: bool,
    features: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionsResponse {
    sessions: Vec<SessionInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    id: String,
    created_at: String,
    last_used_at: String,
    expires_at: String,
    client_ip: Option<String>,
    user_agent: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountExportResponse {
    user: UserInfo,
    entitlements: EntitlementsResponse,
    sessions: Vec<SessionInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteAccountRequest {
    password: String,
    confirm_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminGrantRequest {
    email: String,
    product_code: String,
    plan_code: String,
    ends_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminBootstrapRequest {
    email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUsersResponse {
    users: Vec<AdminUserRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminSetPasswordRequest {
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminSetModeratorRequest {
    email: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminSetDiscountRequest {
    email: String,
    percent: i32,
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminToggleFlagRequest {
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminUserRow {
    id: String,
    email: String,
    created_at: String,
    is_admin: bool,
    is_moderator: bool,
    is_founder: bool,
    discount_percent: Option<i32>,
    discount_label: Option<String>,
    discount_expires_at: Option<String>,
    last_ip: Option<String>,
    kivana_plan_code: Option<String>,
    kivana_plan_name: Option<String>,
    kivana_ends_at: Option<String>,
    kivana_trial_ends_at: Option<String>,
    password_changed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CurrencyAmounts {
    eur: f64,
    gbp: f64,
    nok: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PricingConfig {
    yearly_factor: i32,
    trial_days: i32,
    show_basic: bool,
    show_trial: bool,
    show_standard: bool,
    show_pro: bool,
    show_lifetime: bool,
    show_accountant: bool,
    standard_monthly: CurrencyAmounts,
    pro_monthly: CurrencyAmounts,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortalConfig {
    allow_signups: bool,
    pricing: PricingConfig,
}

impl Default for PortalConfig {
    fn default() -> Self {
        Self {
            allow_signups: true,
            pricing: PricingConfig {
                yearly_factor: 11,
                trial_days: 14,
                show_basic: true,
                show_trial: true,
                show_standard: true,
                show_pro: true,
                show_lifetime: true,
                show_accountant: true,
                standard_monthly: CurrencyAmounts {
                    eur: 9.99,
                    gbp: 9.99,
                    nok: 99.0,
                },
                pro_monthly: CurrencyAmounts {
                    eur: 29.90,
                    gbp: 29.90,
                    nok: 299.0,
                },
            },
        }
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = load_config().context("load config")?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.database_url)
        .await
        .context("connect postgres")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("run migrations")?;

    let jwt = JwtKeys {
        enc: EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
        dec: DecodingKey::from_secret(cfg.jwt_secret.as_bytes()),
    };

    let (tx_events, _) = broadcast::channel(100);

    let state = AppState {
        pool,
        jwt,
        cfg: cfg.clone(),
        tx_events,
        rate_limiter: RateLimiter::new(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_credentials(false);

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/favicon.ico", get(|| async { Redirect::permanent("/kivana-logo.png") }))
        .route("/robots.txt", get(robots_txt))
        .route("/sitemap.xml", get(sitemap_xml))
        .route("/v1/public/config", get(public_config))
        .route("/v1/captcha/challenge", get(captcha_challenge))
        .route("/v1/contact", post(contact))
        .route("/v1/crypto/public-key", get(get_public_key))
        .route("/v1/crypto/public-key", post(set_public_key))
        .route("/v1/support/admin-keys", get(support_admin_keys))
        .route("/v1/support/unread-count", get(support_unread_count))
        .route("/v1/support/threads", get(support_list_threads))
        .route("/v1/support/threads", post(support_create_thread))
        .route("/v1/support/threads/:id", get(support_get_thread))
        .route(
            "/v1/support/threads/:id/messages",
            post(support_send_message),
        )
        .route("/v1/auth/signup", post(signup))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/refresh", post(refresh))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/logout-all", post(logout_all))
        .route("/v1/auth/change-password", post(change_password))
        .route("/v1/me", get(me))
        .route("/v1/profile", post(update_profile))
        .route("/v1/entitlements", get(entitlements))
        .route("/v1/sessions", get(list_sessions))
        .route("/v1/sessions/:id/revoke", post(revoke_session))
        .route("/v1/account/export", get(account_export))
        .route("/v1/account/delete", post(delete_account))
        .route("/v1/admin/bootstrap", post(admin_bootstrap))
        .route("/v1/admin/config", get(admin_get_config))
        .route("/v1/admin/config", post(admin_set_config))
        .route("/v1/admin/paypal/config", get(admin_get_paypal_config))
        .route("/v1/admin/paypal/config", post(admin_set_paypal_config))
        .route("/v1/admin/paypal/sync-plans", post(admin_paypal_sync_plans))
        .route("/v1/admin/users", get(admin_users))
        .route("/v1/admin/contact-messages", get(admin_contact_messages))
        .route(
            "/v1/admin/users/:id/public-key",
            get(admin_user_public_key),
        )
        .route(
            "/v1/admin/support/unread-count",
            get(admin_support_unread_count),
        )
        .route("/v1/admin/support/threads", get(admin_support_list_threads))
        .route("/v1/admin/support/threads/:id", get(admin_support_get_thread))
        .route(
            "/v1/admin/support/threads/:id",
            delete(admin_support_delete_thread),
        )
        .route(
            "/v1/admin/support/threads/:id/messages",
            post(admin_support_send_message),
        )
        .route(
            "/v1/admin/support/threads/:id/archive",
            post(admin_support_archive_thread),
        )
        .route(
            "/v1/admin/support/threads/:id/unarchive",
            post(admin_support_unarchive_thread),
        )
        .route(
            "/v1/admin/support/threads/:id/solve",
            post(admin_support_solve_thread),
        )
        .route(
            "/v1/admin/support/threads/:id/reopen",
            post(admin_support_reopen_thread),
        )
        .route(
            "/v1/admin/contact-messages/:id/read",
            post(admin_contact_mark_read),
        )
        .route(
            "/v1/admin/contact-messages/:id/unread",
            post(admin_contact_mark_unread),
        )
        .route(
            "/v1/admin/contact-messages/:id",
            delete(admin_contact_delete),
        )
        .route("/v1/admin/users/:id", delete(admin_delete_user))
        .route("/v1/admin/users/:id/password", post(admin_set_password))
        .route("/v1/admin/users/:id/admin", post(admin_set_admin_flag))
        .route("/v1/admin/users/:id/founder", post(admin_set_founder_flag))
        .route("/v1/admin/moderator", post(admin_set_moderator))
        .route("/v1/admin/discount", post(admin_set_discount))
        .route("/v1/admin/grant", post(admin_grant))
        .route("/v1/portal/select-plan", post(portal_select_plan))
        .route("/v1/portal/paypal/start", post(portal_paypal_start))
        .route("/v1/portal/paypal/confirm", post(portal_paypal_confirm))
        .route("/v1/paypal/webhook", post(paypal_webhook))
        .route("/v1/events/poll", get(poll_events))
        .route("/admin", get(|| async { Redirect::permanent("/admin/") }))
        .nest_service(
            "/admin/",
            ServeDir::new("kivana-admin").append_index_html_on_directories(true),
        )
        .route("/portal", get(portal_redirect))
        .nest_service(
            "/portal/",
            ServeDir::new("kivana-account").append_index_html_on_directories(true),
        )
        .route("/account", get(account_redirect))
        .nest_service(
            "/account/",
            ServeDir::new("kivana-account").append_index_html_on_directories(true),
        )
        .nest_service(
            "/",
            ServeDir::new("kivana-site").append_index_html_on_directories(true),
        )
        .layer(cors)
        .layer(RequestBodyLimitLayer::new(1_000_000))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(cfg.bind_addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn get_portal_config(pool: &PgPool) -> PortalConfig {
    let row = sqlx::query("SELECT value FROM app_settings WHERE key = 'portal_config' LIMIT 1")
        .fetch_optional(pool)
        .await;
    let v: Option<serde_json::Value> = match row {
        Ok(Some(r)) => r.try_get("value").ok(),
        _ => None,
    };
    match v {
        Some(val) => serde_json::from_value::<PortalConfig>(val).unwrap_or_default(),
        None => PortalConfig::default(),
    }
}

async fn set_portal_config(pool: &PgPool, cfg: &PortalConfig) -> anyhow::Result<()> {
    let now = OffsetDateTime::now_utc();
    let value = serde_json::to_value(cfg)?;
    sqlx::query(
        r#"
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('portal_config', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    "#,
    )
    .bind(value)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn public_config(State(state): State<AppState>) -> axum::response::Response {
    let cfg = get_portal_config(&state.pool).await;
    (StatusCode::OK, Json(cfg)).into_response()
}

async fn captcha_challenge(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    let client_ip = get_client_ip(&headers, connect_info);
    match captcha_make(&state, client_ip) {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "captcha_error").into_response(),
    }
}

#[derive(Serialize, Deserialize)]
struct CaptchaPayloadV1 {
    v: i32,
    exp: i64,
    a: i32,
    b: i32,
    op: String,
    ip: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptchaChallengeResponse {
    question: String,
    token: String,
}

fn captcha_sign(jwt_secret: &str, payload_b64: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(payload_b64.as_bytes());
    hasher.update(b":");
    hasher.update(jwt_secret.as_bytes());
    let digest = hasher.finalize();
    hex::encode(digest)
}

fn captcha_make(state: &AppState, client_ip: Option<String>) -> Result<CaptchaChallengeResponse, ()> {
    let mut b = [0u8; 4];
    rand::rngs::OsRng.fill_bytes(&mut b);
    let r0 = u32::from_le_bytes(b);
    rand::rngs::OsRng.fill_bytes(&mut b);
    let r1 = u32::from_le_bytes(b);

    let a = 2 + (r0 % 18) as i32;
    let b2 = 2 + (r1 % 18) as i32;
    let op = "+".to_string();
    let exp = OffsetDateTime::now_utc().unix_timestamp() + 10 * 60;

    let payload = CaptchaPayloadV1 {
        v: 1,
        exp,
        a,
        b: b2,
        op: op.clone(),
        ip: client_ip.clone(),
    };
    let bytes = serde_json::to_vec(&payload).map_err(|_| ())?;
    let payload_b64 = base64_url(&bytes);
    let sig = captcha_sign(&state.cfg.jwt_secret, &payload_b64);
    let token = format!("c1.{}.{}", payload_b64, sig);
    let question = format!("What is {} {} {}?", a, op, b2);
    Ok(CaptchaChallengeResponse { question, token })
}

fn captcha_verify(state: &AppState, token: &str, answer: &str, client_ip: Option<String>) -> bool {
    let t = token.trim();
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    if parts[0] != "c1" {
        return false;
    }
    let payload_b64 = parts[1];
    let sig = parts[2];
    let expected = captcha_sign(&state.cfg.jwt_secret, payload_b64);
    if expected != sig {
        return false;
    }
    let bytes = match base64_url_decode(payload_b64) {
        Some(v) => v,
        None => return false,
    };
    let payload: CaptchaPayloadV1 = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if payload.v != 1 {
        return false;
    }
    if OffsetDateTime::now_utc().unix_timestamp() > payload.exp {
        return false;
    }
    if let Some(expected_ip) = payload.ip {
        if let Some(ip) = client_ip {
            if expected_ip != ip {
                return false;
            }
        } else {
            return false;
        }
    }
    let ans = answer.trim().parse::<i32>().ok();
    let ans = match ans {
        Some(v) => v,
        None => return false,
    };
    let correct = if payload.op == "+" {
        payload.a + payload.b
    } else if payload.op == "-" {
        payload.a - payload.b
    } else {
        return false;
    };
    ans == correct
}

fn base64_url_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'-' => Some(62),
            b'_' => Some(63),
            _ => None,
        }
    }
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return Some(Vec::new());
    }
    let mut vals = Vec::with_capacity(bytes.len());
    for &c in bytes {
        vals.push(val(c)?);
    }
    let mut out = Vec::with_capacity((vals.len() * 3) / 4 + 4);
    let mut i = 0;
    while i < vals.len() {
        let v0 = vals.get(i).copied()?;
        let v1 = vals.get(i + 1).copied()?;
        let v2 = vals.get(i + 2).copied().unwrap_or(64);
        let v3 = vals.get(i + 3).copied().unwrap_or(64);
        let triple = ((v0 as u32) << 18)
            | ((v1 as u32) << 12)
            | (((v2.min(63)) as u32) << 6)
            | ((v3.min(63)) as u32);
        out.push(((triple >> 16) & 0xff) as u8);
        if v2 != 64 {
            out.push(((triple >> 8) & 0xff) as u8);
        }
        if v3 != 64 {
            out.push((triple & 0xff) as u8);
        }
        i += 4;
    }
    Some(out)
}

async fn admin_get_config(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    let cfg = get_portal_config(&state.pool).await;
    (StatusCode::OK, Json(cfg)).into_response()
}

async fn admin_set_config(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<PortalConfig>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    if req.pricing.yearly_factor < 1 || req.pricing.yearly_factor > 24 {
        return err(StatusCode::BAD_REQUEST, "invalid_yearly_factor").into_response();
    }
    if req.pricing.trial_days < 1 || req.pricing.trial_days > 60 {
        return err(StatusCode::BAD_REQUEST, "invalid_trial_days").into_response();
    }
    if req.pricing.standard_monthly.eur < 0.0
        || req.pricing.standard_monthly.gbp < 0.0
        || req.pricing.standard_monthly.nok < 0.0
        || req.pricing.pro_monthly.eur < 0.0
        || req.pricing.pro_monthly.gbp < 0.0
        || req.pricing.pro_monthly.nok < 0.0
    {
        return err(StatusCode::BAD_REQUEST, "invalid_price").into_response();
    }
    match set_portal_config(&state.pool, &req).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PayPalPlanCycleCurrency {
    eur: Option<String>,
    gbp: Option<String>,
    nok: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PayPalPlanCycles {
    monthly: PayPalPlanCycleCurrency,
    yearly: PayPalPlanCycleCurrency,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PayPalPlanIds {
    standard: PayPalPlanCycles,
    pro: PayPalPlanCycles,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PayPalConfig {
    enabled: bool,
    mode: String,
    client_id: String,
    secret: String,
    webhook_id: String,
    product_id: Option<String>,
    plans: PayPalPlanIds,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PayPalConfigResponse {
    enabled: bool,
    mode: String,
    client_id: String,
    has_secret: bool,
    webhook_id: String,
    product_id: Option<String>,
    plans: PayPalPlanIds,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayPalConfigUpdateRequest {
    enabled: bool,
    mode: String,
    client_id: String,
    secret: Option<String>,
    webhook_id: String,
    product_id: Option<String>,
    plans: Option<PayPalPlanIds>,
}

async fn get_paypal_config(pool: &PgPool) -> PayPalConfig {
    let row = sqlx::query("SELECT value FROM app_settings WHERE key = 'paypal_config' LIMIT 1")
        .fetch_optional(pool)
        .await;
    let v: Option<serde_json::Value> = match row {
        Ok(Some(r)) => r.try_get("value").ok(),
        _ => None,
    };
    let mut cfg = match v {
        Some(val) => serde_json::from_value::<PayPalConfig>(val).unwrap_or_default(),
        None => PayPalConfig::default(),
    };
    if cfg.mode.trim().is_empty() {
        cfg.mode = "sandbox".to_string();
    }
    cfg
}

async fn set_paypal_config(pool: &PgPool, cfg: &PayPalConfig) -> anyhow::Result<()> {
    let now = OffsetDateTime::now_utc();
    let value = serde_json::to_value(cfg)?;
    sqlx::query(
        r#"
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('paypal_config', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    "#,
    )
    .bind(value)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn admin_get_paypal_config(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    let cfg = get_paypal_config(&state.pool).await;
    (
        StatusCode::OK,
        Json(PayPalConfigResponse {
            enabled: cfg.enabled,
            mode: cfg.mode,
            client_id: cfg.client_id,
            has_secret: !cfg.secret.trim().is_empty(),
            webhook_id: cfg.webhook_id,
            product_id: cfg.product_id,
            plans: cfg.plans,
        }),
    )
        .into_response()
}

async fn admin_set_paypal_config(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<PayPalConfigUpdateRequest>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    let mode = req.mode.trim().to_lowercase();
    if mode != "sandbox" && mode != "live" {
        return err(StatusCode::BAD_REQUEST, "invalid_mode").into_response();
    }
    let mut cfg = get_paypal_config(&state.pool).await;
    cfg.enabled = req.enabled;
    cfg.mode = mode;
    cfg.client_id = req.client_id.trim().to_string();
    cfg.webhook_id = req.webhook_id.trim().to_string();
    cfg.product_id = req.product_id.clone().and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    if let Some(plans) = req.plans {
        cfg.plans = plans;
    }
    if let Some(sec) = req.secret {
        let s = sec.trim().to_string();
        if !s.is_empty() {
            cfg.secret = s;
        }
    }
    if let Err(_) = set_paypal_config(&state.pool, &cfg).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }
    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

fn paypal_base_url(mode: &str) -> &'static str {
    if mode == "live" {
        "https://api-m.paypal.com"
    } else {
        "https://api-m.sandbox.paypal.com"
    }
}

#[derive(Deserialize)]
struct PayPalTokenResponse {
    access_token: String,
}

async fn paypal_access_token(cfg: &PayPalConfig) -> anyhow::Result<String> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let res = client
        .post(format!("{}/v1/oauth2/token", base))
        .basic_auth(cfg.client_id.clone(), Some(cfg.secret.clone()))
        .header("content-type", "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_auth_failed");
    }
    let json = res.json::<PayPalTokenResponse>().await?;
    Ok(json.access_token)
}

#[derive(Deserialize)]
struct PayPalCreateProductResponse {
    id: String,
}

async fn paypal_create_product(cfg: &PayPalConfig, token: &str) -> anyhow::Result<String> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let res = client
        .post(format!("{}/v1/catalogs/products", base))
        .bearer_auth(token)
        .json(&serde_json::json!({
          "name": "Kivana Subscription",
          "type": "SERVICE",
          "category": "SOFTWARE"
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_product_failed");
    }
    let json = res.json::<PayPalCreateProductResponse>().await?;
    Ok(json.id)
}

#[derive(Deserialize)]
struct PayPalCreatePlanResponse {
    id: String,
}

async fn paypal_create_plan(
    cfg: &PayPalConfig,
    token: &str,
    product_id: &str,
    name: &str,
    currency: &str,
    interval_unit: &str,
    price: f64,
) -> anyhow::Result<String> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let value = if currency == "NOK" {
        format!("{}", (price.round() as i64))
    } else {
        format!("{:.2}", price)
    };
    let res = client
        .post(format!("{}/v1/billing/plans", base))
        .bearer_auth(token)
        .json(&serde_json::json!({
          "product_id": product_id,
          "name": name,
          "billing_cycles": [{
            "frequency": { "interval_unit": interval_unit, "interval_count": 1 },
            "tenure_type": "REGULAR",
            "sequence": 1,
            "total_cycles": 0,
            "pricing_scheme": { "fixed_price": { "value": value, "currency_code": currency } }
          }],
          "payment_preferences": {
            "auto_bill_outstanding": true,
            "setup_fee_failure_action": "CANCEL",
            "payment_failure_threshold": 1
          }
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_plan_failed");
    }
    let json = res.json::<PayPalCreatePlanResponse>().await?;
    Ok(json.id)
}

async fn admin_paypal_sync_plans(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    let portal_cfg = get_portal_config(&state.pool).await;
    let mut cfg = get_paypal_config(&state.pool).await;
    if cfg.client_id.trim().is_empty() || cfg.secret.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "paypal_not_configured").into_response();
    }
    let token = match paypal_access_token(&cfg).await {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_auth_failed").into_response(),
    };
    let product_id = match cfg.product_id.clone() {
        Some(v) if !v.trim().is_empty() => v,
        _ => match paypal_create_product(&cfg, &token).await {
            Ok(id) => id,
            Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_product_failed").into_response(),
        },
    };

    let yearly_factor = portal_cfg.pricing.yearly_factor as f64;
    let std_eur_m = portal_cfg.pricing.standard_monthly.eur;
    let std_gbp_m = portal_cfg.pricing.standard_monthly.gbp;
    let std_nok_m = portal_cfg.pricing.standard_monthly.nok;
    let pro_eur_m = portal_cfg.pricing.pro_monthly.eur;
    let pro_gbp_m = portal_cfg.pricing.pro_monthly.gbp;
    let pro_nok_m = portal_cfg.pricing.pro_monthly.nok;

    let mut plans = PayPalPlanIds::default();

    let mk = |tier: &str, cycle: &str, cur: &str| format!("Kivana {} {} ({})", tier, cycle, cur);

    let std_eur_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Monthly", "EUR"), "EUR", "MONTH", std_eur_m).await;
    let std_eur_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Yearly", "EUR"), "EUR", "YEAR", std_eur_m * yearly_factor).await;
    let std_gbp_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Monthly", "GBP"), "GBP", "MONTH", std_gbp_m).await;
    let std_gbp_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Yearly", "GBP"), "GBP", "YEAR", std_gbp_m * yearly_factor).await;
    let std_nok_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Monthly", "NOK"), "NOK", "MONTH", std_nok_m).await;
    let std_nok_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Ordinary", "Yearly", "NOK"), "NOK", "YEAR", std_nok_m * yearly_factor).await;

    let pro_eur_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Monthly", "EUR"), "EUR", "MONTH", pro_eur_m).await;
    let pro_eur_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Yearly", "EUR"), "EUR", "YEAR", pro_eur_m * yearly_factor).await;
    let pro_gbp_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Monthly", "GBP"), "GBP", "MONTH", pro_gbp_m).await;
    let pro_gbp_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Yearly", "GBP"), "GBP", "YEAR", pro_gbp_m * yearly_factor).await;
    let pro_nok_m_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Monthly", "NOK"), "NOK", "MONTH", pro_nok_m).await;
    let pro_nok_y_id = paypal_create_plan(&cfg, &token, &product_id, &mk("Pro", "Yearly", "NOK"), "NOK", "YEAR", pro_nok_m * yearly_factor).await;

    let ids = [
        std_eur_m_id,
        std_eur_y_id,
        std_gbp_m_id,
        std_gbp_y_id,
        std_nok_m_id,
        std_nok_y_id,
        pro_eur_m_id,
        pro_eur_y_id,
        pro_gbp_m_id,
        pro_gbp_y_id,
        pro_nok_m_id,
        pro_nok_y_id,
    ];
    if ids.iter().any(|r| r.is_err()) {
        return err(StatusCode::BAD_REQUEST, "paypal_plan_failed").into_response();
    }

    plans.standard.monthly.eur = Some(ids[0].as_ref().unwrap().clone());
    plans.standard.yearly.eur = Some(ids[1].as_ref().unwrap().clone());
    plans.standard.monthly.gbp = Some(ids[2].as_ref().unwrap().clone());
    plans.standard.yearly.gbp = Some(ids[3].as_ref().unwrap().clone());
    plans.standard.monthly.nok = Some(ids[4].as_ref().unwrap().clone());
    plans.standard.yearly.nok = Some(ids[5].as_ref().unwrap().clone());
    plans.pro.monthly.eur = Some(ids[6].as_ref().unwrap().clone());
    plans.pro.yearly.eur = Some(ids[7].as_ref().unwrap().clone());
    plans.pro.monthly.gbp = Some(ids[8].as_ref().unwrap().clone());
    plans.pro.yearly.gbp = Some(ids[9].as_ref().unwrap().clone());
    plans.pro.monthly.nok = Some(ids[10].as_ref().unwrap().clone());
    plans.pro.yearly.nok = Some(ids[11].as_ref().unwrap().clone());

    cfg.product_id = Some(product_id);
    cfg.plans = plans.clone();
    if let Err(_) = set_paypal_config(&state.pool, &cfg).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "productId": cfg.product_id, "plans": plans })),
    )
        .into_response()
}

async fn portal_redirect(uri: OriginalUri) -> impl IntoResponse {
    let q = uri.0.query().map(|v| format!("?{}", v)).unwrap_or_default();
    let target = format!("/account/{}", q);
    Redirect::permanent(&target)
}

async fn account_redirect(uri: OriginalUri) -> impl IntoResponse {
    let q = uri.0.query().map(|v| format!("?{}", v)).unwrap_or_default();
    let target = format!("/account/{}", q);
    Redirect::permanent(&target)
}

async fn robots_txt() -> impl IntoResponse {
    let domain = std::env::var("KIVANA_DOMAIN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "kivana.eu".to_string());
    let body = format!(
        "User-agent: *\nAllow: /\nSitemap: https://{}/sitemap.xml\n",
        domain
    );
    ([(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")], body)
}

async fn sitemap_xml() -> impl IntoResponse {
    let domain = std::env::var("KIVANA_DOMAIN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "kivana.eu".to_string());
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://{}/</loc></url>
  <url><loc>https://{}/privacy.html</loc></url>
  <url><loc>https://{}/terms.html</loc></url>
</urlset>
"#,
        domain, domain, domain
    );
    ([(axum::http::header::CONTENT_TYPE, "application/xml; charset=utf-8")], body)
}

async fn contact(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<ContactRequest>,
) -> axum::response::Response {
    let client_ip = get_client_ip(&headers, connect_info);
    if !state
        .rate_limiter
        .allow(
            format!(
                "contact:{}",
                client_ip.clone().unwrap_or_else(|| "unknown".to_string())
            ),
            StdDuration::from_secs(10 * 60),
            5,
        )
        .await
    {
        return err(StatusCode::TOO_MANY_REQUESTS, "too_many_requests").into_response();
    }

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 120 {
        return err(StatusCode::BAD_REQUEST, "invalid_name").into_response();
    }
    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }
    let message = req.message.trim().to_string();
    if message.len() < 10 || message.len() > 8000 {
        return err(StatusCode::BAD_REQUEST, "invalid_message").into_response();
    }

    let subject = req.subject.map(|s| {
        let mut v = s.trim().to_string();
        v.retain(|c| c != '\r' && c != '\n');
        if v.is_empty() {
            return "".to_string();
        }
        if v.len() > 140 {
            v.truncate(140);
        }
        v
    });
    let subject = subject.and_then(|s| if s.is_empty() { None } else { Some(s) });

    let id = Uuid::new_v4();
    let res = sqlx::query(
        r#"
      INSERT INTO contact_messages (id, name, email, subject, message, client_ip)
      VALUES ($1, $2, $3, $4, $5, $6)
    "#,
    )
    .bind(id)
    .bind(&name)
    .bind(&email)
    .bind(&subject)
    .bind(&message)
    .bind(&client_ip)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => {
            let now = OffsetDateTime::now_utc();

            let user_row = sqlx::query("SELECT id FROM users WHERE email = $1 LIMIT 1")
                .bind(&email)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
            let user_id: Option<Uuid> = user_row.as_ref().map(|r| r.get::<Uuid, _>("id"));

            let thread_id: Option<Uuid> = if let Some(uid) = user_id {
                sqlx::query(
                    "SELECT id FROM support_threads WHERE user_id = $1 AND status = 'open' ORDER BY created_at ASC LIMIT 1",
                )
                .bind(uid)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .map(|r| r.get::<Uuid, _>("id"))
            } else {
                sqlx::query(
                    "SELECT id FROM support_threads WHERE guest_email = $1 AND status = 'open' ORDER BY created_at ASC LIMIT 1",
                )
                .bind(&email)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .map(|r| r.get::<Uuid, _>("id"))
            };

            let thread_id = match thread_id {
                Some(v) => v,
                None => {
                    let subject_v = subject
                        .clone()
                        .unwrap_or_else(|| "Support request".to_string());
                    let _ = sqlx::query(
                        r#"
                      INSERT INTO support_threads (id, user_id, guest_email, guest_name, subject, status, last_message_at, last_sender_role, created_at, updated_at)
                      VALUES ($1, $2, $3, $4, $5, 'open', $6, 'user', $6, $6)
                    "#,
                    )
                    .bind(id)
                    .bind(user_id)
                    .bind(if user_id.is_some() { None::<String> } else { Some(email.clone()) })
                    .bind(if user_id.is_some() { None::<String> } else { Some(name.clone()) })
                    .bind(subject_v)
                    .bind(now)
                    .execute(&state.pool)
                    .await;
                    id
                }
            };

            let _ = sqlx::query(
                r#"
              INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, body, created_at)
              VALUES ($1, $2, 'user', $3, $4, $5)
              ON CONFLICT (id) DO NOTHING
            "#,
            )
            .bind(id)
            .bind(thread_id)
            .bind(user_id)
            .bind(&message)
            .bind(now)
            .execute(&state.pool)
            .await;

            let _ = sqlx::query(
                r#"
              UPDATE support_threads
                 SET last_message_at = $1,
                     last_sender_role = 'user',
                     updated_at = $1
               WHERE id = $2
            "#,
            )
            .bind(now)
            .bind(thread_id)
            .execute(&state.pool)
            .await;

            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_contact_messages(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let rows = sqlx::query(
        r#"
      SELECT
        id,
        created_at,
        name,
        email,
        subject,
        message,
        client_ip,
        is_read,
        read_at
      FROM contact_messages
      ORDER BY created_at DESC
      LIMIT 200
    "#,
    )
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut messages: Vec<AdminContactMessageRow> = Vec::with_capacity(rows.len());
    for r in rows {
        let id: Uuid = r.get("id");
        let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
        let read_at: Option<sqlx::types::time::OffsetDateTime> = r.try_get("read_at").ok();

        messages.push(AdminContactMessageRow {
            id: id.to_string(),
            created_at: created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            name: r.get::<String, _>("name"),
            email: r.get::<String, _>("email"),
            subject: r.try_get::<Option<String>, _>("subject").ok().flatten(),
            message: r.get::<String, _>("message"),
            client_ip: r.try_get::<Option<String>, _>("client_ip").ok().flatten(),
            is_read: r.get::<bool, _>("is_read"),
            read_at: read_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
        });
    }

    (StatusCode::OK, Json(AdminContactMessagesResponse { messages })).into_response()
}

async fn admin_contact_mark_read(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let res = sqlx::query(
        "UPDATE contact_messages SET is_read = TRUE, read_at = now() WHERE id = $1 AND is_read = FALSE",
    )
    .bind(id)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_contact_mark_unread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let res = sqlx::query(
        "UPDATE contact_messages SET is_read = FALSE, read_at = NULL WHERE id = $1 AND is_read = TRUE",
    )
    .bind(id)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_contact_delete(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let res = sqlx::query("DELETE FROM contact_messages WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

fn clean_support_subject(subject: Option<String>) -> String {
    let subject = subject.map(|s| {
        let mut v = s.trim().to_string();
        v.retain(|c| c != '\r' && c != '\n');
        if v.len() > 140 {
            v.truncate(140);
        }
        v
    });
    let subject = subject.and_then(|s| if s.is_empty() { None } else { Some(s) });
    subject.unwrap_or_else(|| "Support".to_string())
}

fn validate_support_body(body: &str) -> Result<String, axum::response::Response> {
    let v = body.trim().to_string();
    if v.is_empty() || v.len() > 50_000 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid_message").into_response());
    }
    if !v.starts_with("e2ee:") {
        return Err(err(StatusCode::BAD_REQUEST, "encryption_required").into_response());
    }
    Ok(v)
}

async fn get_public_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query("SELECT chat_public_jwk FROM users WHERE id = $1 LIMIT 1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await;

    let public_jwk: Option<serde_json::Value> = match row {
        Ok(Some(r)) => r.try_get("chat_public_jwk").ok(),
        Ok(None) => None,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    (StatusCode::OK, Json(PublicKeyResponse { public_jwk })).into_response()
}

async fn set_public_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SetPublicKeyRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    if !req.public_jwk.is_object() {
        return err(StatusCode::BAD_REQUEST, "invalid_public_key").into_response();
    }
    let size = serde_json::to_string(&req.public_jwk)
        .ok()
        .map(|s| s.len())
        .unwrap_or(0);
    if size == 0 || size > 20_000 {
        return err(StatusCode::BAD_REQUEST, "invalid_public_key").into_response();
    }

    let res = sqlx::query("UPDATE users SET chat_public_jwk = $1 WHERE id = $2")
        .bind(req.public_jwk)
        .bind(user_id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn support_admin_keys(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let _user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let rows = sqlx::query(
        r#"
      SELECT id, chat_public_jwk
      FROM users
      WHERE (is_admin = TRUE OR is_moderator = TRUE)
        AND chat_public_jwk IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 50
    "#,
    )
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut admins = Vec::with_capacity(rows.len());
    for r in rows {
        let id: Uuid = r.get("id");
        let public_jwk: serde_json::Value = match r.try_get("chat_public_jwk").ok() {
            Some(v) => v,
            None => continue,
        };
        admins.push(AdminKeyRow {
            id: id.to_string(),
            public_jwk,
        });
    }

    (StatusCode::OK, Json(AdminKeysResponse { admins })).into_response()
}

async fn support_unread_count(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query(
        r#"
      SELECT COUNT(*)::bigint AS cnt
      FROM support_threads
      WHERE user_id = $1
        AND status = 'open'
        AND last_sender_role = 'admin'
        AND (user_last_read_at IS NULL OR last_message_at > user_last_read_at)
    "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;

    let cnt: i64 = match row {
        Ok(Some(r)) => r.try_get::<i64, _>("cnt").unwrap_or(0),
        Ok(None) => 0,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    (StatusCode::OK, Json(UnreadCountResponse { count: cnt })).into_response()
}

async fn admin_support_unread_count(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let row = sqlx::query(
        r#"
      SELECT COUNT(*)::bigint AS cnt
      FROM support_threads t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.status = 'open'
        AND t.last_sender_role = 'user'
        AND (t.admin_last_read_at IS NULL OR t.last_message_at > t.admin_last_read_at)
        AND (u.is_admin IS DISTINCT FROM TRUE)
        AND (u.is_moderator IS DISTINCT FROM TRUE)
    "#,
    )
    .fetch_optional(&state.pool)
    .await;

    let cnt: i64 = match row {
        Ok(Some(r)) => r.try_get::<i64, _>("cnt").unwrap_or(0),
        Ok(None) => 0,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    (StatusCode::OK, Json(UnreadCountResponse { count: cnt })).into_response()
}

async fn admin_user_public_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let row = sqlx::query("SELECT chat_public_jwk FROM users WHERE id = $1 LIMIT 1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await;

    let public_jwk: Option<serde_json::Value> = match row {
        Ok(Some(r)) => r.try_get("chat_public_jwk").ok(),
        Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    (StatusCode::OK, Json(PublicKeyResponse { public_jwk })).into_response()
}

async fn support_list_threads(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let rows = sqlx::query(
        r#"
      SELECT
        id,
        subject,
        status,
        last_message_at,
        last_sender_role,
        user_last_read_at
      FROM support_threads
      WHERE user_id = $1
      ORDER BY last_message_at DESC
      LIMIT 50
    "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut threads = Vec::with_capacity(rows.len());
    for r in rows {
        let id: Uuid = r.get("id");
        let subject: String = r.get("subject");
        let status: String = r.get("status");
        let last_message_at: sqlx::types::time::OffsetDateTime = r.get("last_message_at");
        let last_sender_role: String = r.get("last_sender_role");
        let user_last_read_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("user_last_read_at").ok().flatten();
        let has_unread = last_sender_role == "admin"
            && user_last_read_at
                .map(|t| last_message_at > t)
                .unwrap_or(true);

        threads.push(SupportThreadSummary {
            id: id.to_string(),
            subject,
            status,
            last_message_at: last_message_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            last_sender_role,
            has_unread,
        });
    }

    (StatusCode::OK, Json(SupportThreadsResponse { threads })).into_response()
}

async fn support_get_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query(
        r#"
      SELECT
        id,
        subject,
        status,
        created_at,
        last_message_at,
        last_sender_role
      FROM support_threads
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;

    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let created_at: sqlx::types::time::OffsetDateTime = row.get("created_at");
    let last_message_at: sqlx::types::time::OffsetDateTime = row.get("last_message_at");
    let last_sender_role: String = row.get("last_sender_role");

    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query("UPDATE support_threads SET user_last_read_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    let msg_rows = sqlx::query(
        r#"
      SELECT id, sender_role, body, created_at
      FROM support_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC
      LIMIT 500
    "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await;

    let msg_rows = match msg_rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut messages = Vec::with_capacity(msg_rows.len());
    for r in msg_rows {
        let mid: Uuid = r.get("id");
        let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
        messages.push(SupportMessageRow {
            id: mid.to_string(),
            sender_role: r.get::<String, _>("sender_role"),
            body: r.get::<String, _>("body"),
            created_at: created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        });
    }

    let thread = SupportThreadDetail {
        id: row.get::<Uuid, _>("id").to_string(),
        subject: row.get::<String, _>("subject"),
        status: row.get::<String, _>("status"),
        created_at: created_at
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_message_at: last_message_at
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_sender_role,
    };

    (
        StatusCode::OK,
        Json(SupportThreadResponse { thread, messages }),
    )
        .into_response()
}

async fn support_create_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SupportCreateThreadRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let body = match validate_support_body(&req.message) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let subject = clean_support_subject(req.subject);

    let now = OffsetDateTime::now_utc();
    let thread_id = Uuid::new_v4();
    let msg_id = Uuid::new_v4();

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let res = sqlx::query(
        r#"
      INSERT INTO support_threads (
        id, user_id, subject, status, last_message_at, last_sender_role, user_last_read_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, 'open', $4, 'user', $4, $4, $4)
    "#,
    )
    .bind(thread_id)
    .bind(user_id)
    .bind(&subject)
    .bind(now)
    .execute(&mut *tx)
    .await;

    if res.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let res = sqlx::query(
        r#"
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, body, created_at)
      VALUES ($1, $2, 'user', $3, $4, $5)
    "#,
    )
    .bind(msg_id)
    .bind(thread_id)
    .bind(user_id)
    .bind(&body)
    .bind(now)
    .execute(&mut *tx)
    .await;

    if res.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    if tx.commit().await.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let thread = SupportThreadDetail {
        id: thread_id.to_string(),
        subject,
        status: "open".to_string(),
        created_at: now
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_message_at: now
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_sender_role: "user".to_string(),
    };

    let messages = vec![SupportMessageRow {
        id: msg_id.to_string(),
        sender_role: "user".to_string(),
        body,
        created_at: now
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    }];

    (
        StatusCode::OK,
        Json(SupportThreadResponse { thread, messages }),
    )
        .into_response()
}

async fn support_send_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<SupportSendMessageRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let body = match validate_support_body(&req.message) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query("SELECT 1 AS ok FROM support_threads WHERE id = $1 AND user_id = $2 LIMIT 1")
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await;

    match row {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let now = OffsetDateTime::now_utc();
    let msg_id = Uuid::new_v4();

    let res = sqlx::query(
        r#"
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, body, created_at)
      VALUES ($1, $2, 'user', $3, $4, $5)
    "#,
    )
    .bind(msg_id)
    .bind(id)
    .bind(user_id)
    .bind(&body)
    .bind(now)
    .execute(&state.pool)
    .await;

    if res.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let _ = sqlx::query(
        r#"
      UPDATE support_threads
         SET last_message_at = $1,
             last_sender_role = 'user',
             user_last_read_at = $1,
             status = 'open',
             updated_at = $1
       WHERE id = $2
    "#,
    )
    .bind(now)
    .bind(id)
    .execute(&state.pool)
    .await;

    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

async fn admin_support_list_threads(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Query(q): Query<AdminSupportThreadsQuery>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let status_filter = q.status.and_then(|s| {
        let v = s.trim().to_lowercase();
        if v.is_empty() || v == "all" {
            None
        } else {
            Some(v)
        }
    });
    let q_like = q.q.and_then(|s| {
        let v = s.trim().to_string();
        if v.is_empty() {
            None
        } else {
            Some(format!("%{}%", v))
        }
    });

    let rows = sqlx::query(
        r#"
      SELECT
        t.id AS id,
        t.subject AS subject,
        t.status AS status,
        t.last_message_at AS last_message_at,
        t.last_sender_role AS last_sender_role,
        t.admin_last_read_at AS admin_last_read_at,
        t.user_id AS user_id,
        t.guest_email AS guest_email,
        t.guest_name AS guest_name,
        u.email AS u_email,
        u.display_name AS u_name
      FROM support_threads t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE (u.is_admin IS DISTINCT FROM TRUE)
        AND (u.is_moderator IS DISTINCT FROM TRUE)
        AND ($1::uuid IS NULL OR t.user_id = $1)
        AND ($2::text IS NULL OR t.status = $2)
        AND (
          $3::text IS NULL
          OR t.subject ILIKE $3
          OR COALESCE(u.email, '') ILIKE $3
          OR COALESCE(u.display_name, '') ILIKE $3
          OR COALESCE(t.guest_email, '') ILIKE $3
          OR COALESCE(t.guest_name, '') ILIKE $3
        )
      ORDER BY t.last_message_at DESC
      LIMIT 200
    "#,
    )
    .bind(q.user_id)
    .bind(status_filter)
    .bind(q_like)
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut threads = Vec::with_capacity(rows.len());
    for r in rows {
        let id: Uuid = r.get("id");
        let last_message_at: sqlx::types::time::OffsetDateTime = r.get("last_message_at");
        let last_sender_role: String = r.get("last_sender_role");
        let admin_last_read_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("admin_last_read_at").ok().flatten();
        let status: String = r.get("status");
        let has_unread = status == "open"
            && last_sender_role == "user"
            && admin_last_read_at
                .map(|t| last_message_at > t)
                .unwrap_or(true);

        let user_id: Option<Uuid> = r.try_get("user_id").ok();
        let u_email: Option<String> = r.try_get("u_email").ok().flatten();
        let u_name: Option<String> = r.try_get("u_name").ok().flatten();
        let guest_email: Option<String> = r.try_get("guest_email").ok().flatten();
        let guest_name: Option<String> = r.try_get("guest_name").ok().flatten();

        let user_email = u_email
            .clone()
            .or(guest_email)
            .unwrap_or_else(|| "".to_string());
        let user_name = u_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or(guest_name)
            .unwrap_or_else(|| "".to_string());

        threads.push(AdminSupportThreadSummary {
            id: id.to_string(),
            subject: r.get::<String, _>("subject"),
            status,
            last_message_at: last_message_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            last_sender_role,
            has_unread,
            user_email,
            user_name,
            user_id: user_id.map(|u| u.to_string()),
        });
    }

    (StatusCode::OK, Json(AdminSupportThreadsResponse { threads })).into_response()
}

async fn admin_support_get_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let row = sqlx::query(
        r#"
      SELECT
        t.id AS id,
        t.subject AS subject,
        t.status AS status,
        t.created_at AS created_at,
        t.last_message_at AS last_message_at,
        t.last_sender_role AS last_sender_role,
        t.admin_last_read_at AS admin_last_read_at,
        t.user_id AS user_id,
        t.guest_email AS guest_email,
        t.guest_name AS guest_name,
        u.email AS u_email,
        u.display_name AS u_name
      FROM support_threads t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = $1
      LIMIT 1
    "#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await;

    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let created_at: sqlx::types::time::OffsetDateTime = row.get("created_at");
    let last_message_at: sqlx::types::time::OffsetDateTime = row.get("last_message_at");
    let last_sender_role: String = row.get("last_sender_role");
    let admin_last_read_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("admin_last_read_at").ok().flatten();
    let status: String = row.get("status");
    let has_unread = status == "open"
        && last_sender_role == "user"
        && admin_last_read_at
            .map(|t| last_message_at > t)
            .unwrap_or(true);

    let user_id: Option<Uuid> = row.try_get("user_id").ok();
    let u_email: Option<String> = row.try_get("u_email").ok().flatten();
    let u_name: Option<String> = row.try_get("u_name").ok().flatten();
    let guest_email: Option<String> = row.try_get("guest_email").ok().flatten();
    let guest_name: Option<String> = row.try_get("guest_name").ok().flatten();

    let user_email = u_email
        .clone()
        .or(guest_email)
        .unwrap_or_else(|| "".to_string());
    let user_name = u_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or(guest_name)
        .unwrap_or_else(|| "".to_string());

    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query("UPDATE support_threads SET admin_last_read_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    let msg_rows = sqlx::query(
        r#"
      SELECT id, sender_role, body, created_at
      FROM support_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC
      LIMIT 500
    "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await;

    let msg_rows = match msg_rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut messages = Vec::with_capacity(msg_rows.len());
    for r in msg_rows {
        let mid: Uuid = r.get("id");
        let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
        messages.push(SupportMessageRow {
            id: mid.to_string(),
            sender_role: r.get::<String, _>("sender_role"),
            body: r.get::<String, _>("body"),
            created_at: created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        });
    }

    let thread = AdminSupportThreadDetail {
        id: row.get::<Uuid, _>("id").to_string(),
        subject: row.get::<String, _>("subject"),
        status,
        created_at: created_at
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_message_at: last_message_at
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        last_sender_role,
        has_unread,
        user_email,
        user_name,
        user_id: user_id.map(|u| u.to_string()),
    };

    (
        StatusCode::OK,
        Json(AdminSupportThreadResponse { thread, messages }),
    )
        .into_response()
}

async fn admin_support_send_message(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<SupportSendMessageRequest>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }
    let admin_user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let body = match validate_support_body(&req.message) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query("SELECT 1 AS ok FROM support_threads WHERE id = $1 LIMIT 1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await;

    match row {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let now = OffsetDateTime::now_utc();
    let msg_id = Uuid::new_v4();

    let res = sqlx::query(
        r#"
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, body, created_at)
      VALUES ($1, $2, 'admin', $3, $4, $5)
    "#,
    )
    .bind(msg_id)
    .bind(id)
    .bind(admin_user_id)
    .bind(&body)
    .bind(now)
    .execute(&state.pool)
    .await;

    if res.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let _ = sqlx::query(
        r#"
      UPDATE support_threads
         SET last_message_at = $1,
             last_sender_role = 'admin',
             admin_last_read_at = $1,
             status = 'open',
             updated_at = $1
       WHERE id = $2
    "#,
    )
    .bind(now)
    .bind(id)
    .execute(&state.pool)
    .await;

    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

async fn admin_support_archive_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let now = OffsetDateTime::now_utc();
    let res = sqlx::query("UPDATE support_threads SET status = 'archived', updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_support_unarchive_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let now = OffsetDateTime::now_utc();
    let res = sqlx::query("UPDATE support_threads SET status = 'open', updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_support_solve_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let now = OffsetDateTime::now_utc();
    let res = sqlx::query("UPDATE support_threads SET status = 'solved', updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_support_reopen_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let now = OffsetDateTime::now_utc();
    let res = sqlx::query("UPDATE support_threads SET status = 'open', updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_support_delete_thread(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let res = sqlx::query("DELETE FROM support_threads WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "thread_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn signup(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<SignupRequest>,
) -> axum::response::Response {
    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }
    if req.password.len() < 8 {
        return err(StatusCode::BAD_REQUEST, "weak_password").into_response();
    }

    let cfg = get_portal_config(&state.pool).await;
    if !cfg.allow_signups {
        return err(StatusCode::SERVICE_UNAVAILABLE, "signups_disabled").into_response();
    }

    let client_ip = get_client_ip(&headers, connect_info);
    if !state
        .rate_limiter
        .allow(
            format!("signup:{}", client_ip.clone().unwrap_or_else(|| "unknown".to_string())),
            StdDuration::from_secs(10 * 60),
            5,
        )
        .await
    {
        return err(StatusCode::TOO_MANY_REQUESTS, "too_many_requests").into_response();
    }

    let cap_tok = req.captcha_token.clone().unwrap_or_default();
    let cap_ans = req.captcha_answer.clone().unwrap_or_default();
    if cap_tok.trim().is_empty() || cap_ans.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "captcha_required").into_response();
    }
    if !captcha_verify(&state, &cap_tok, &cap_ans, client_ip.clone()) {
        return err(StatusCode::BAD_REQUEST, "captcha_failed").into_response();
    }

    let user_id = Uuid::new_v4();
    let password_hash = match hash_password(&req.password) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed").into_response(),
    };
    let now = OffsetDateTime::now_utc();

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let inserted = sqlx::query(
        r#"
      INSERT INTO users (id, email, password_hash, last_ip, password_changed_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    "#,
    )
    .bind(user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&client_ip)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await;

    match inserted {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::CONFLICT, "email_in_use").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }

    let _ = sqlx::query("SELECT pg_advisory_xact_lock(780001)")
        .execute(&mut *tx)
        .await;
    let founders_count_row = sqlx::query("SELECT COUNT(*) AS c FROM users WHERE is_founder = TRUE")
        .fetch_one(&mut *tx)
        .await;
    let founders_count: i64 = match founders_count_row {
        Ok(r) => r.get::<i64, _>("c"),
        Err(_) => 0,
    };
    if founders_count < 20 {
        let _ = sqlx::query(
            r#"
          UPDATE users
          SET is_founder = TRUE,
              founder_discount_at = $1,
              discount_percent = 50,
              discount_label = 'founder',
              discount_expires_at = NULL
          WHERE id = $2
            AND is_admin = FALSE
            AND is_founder = FALSE
        "#,
        )
        .bind(now)
        .bind(user_id)
        .execute(&mut *tx)
        .await;
    }

    let prod_row = sqlx::query("SELECT id FROM products WHERE code = 'kivana' LIMIT 1")
        .fetch_optional(&mut *tx)
        .await;
    let product_id: Uuid = match prod_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = 'standard' LIMIT 1")
        .bind(product_id)
        .fetch_optional(&mut *tx)
        .await;
    let plan_id: Uuid = match plan_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let trial_end = now + Duration::days(14);
    let _ = sqlx::query(
        "INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, ends_at, trial_ends_at) VALUES ($1,$2,$3,$4,'active',$5,$6,$7)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(product_id)
    .bind(plan_id)
    .bind(now)
    .bind(trial_end)
    .bind(trial_end)
    .execute(&mut *tx)
    .await;

    if tx.commit().await.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let flags = sqlx::query(
        "SELECT is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await;
    let (is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at) = match flags {
        Ok(r) => (
            r.try_get::<bool, _>("is_admin").unwrap_or(false),
            r.try_get::<bool, _>("is_moderator").unwrap_or(false),
            r.try_get::<bool, _>("is_founder").unwrap_or(false),
            r.try_get::<Option<i32>, _>("discount_percent").ok().flatten(),
            r.try_get::<Option<String>, _>("discount_label").ok().flatten(),
            r.try_get::<Option<sqlx::types::time::OffsetDateTime>, _>("discount_expires_at")
                .ok()
                .flatten(),
        ),
        Err(_) => (false, false, false, None, None, None),
    };

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let tokens = issue_tokens(
        &state,
        user_id,
        &email,
        client_ip,
        user_agent,
        is_admin,
        is_moderator,
        is_founder,
        discount_percent,
        discount_label,
        discount_expires_at,
    )
    .await;
    match tokens {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "token_error").into_response(),
    }
}

async fn login(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<LoginRequest>,
) -> axum::response::Response {
    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }

    let client_ip = get_client_ip(&headers, connect_info);
    if !state
        .rate_limiter
        .allow(
            format!("login:{}", client_ip.clone().unwrap_or_else(|| "unknown".to_string())),
            StdDuration::from_secs(60),
            10,
        )
        .await
    {
        return err(StatusCode::TOO_MANY_REQUESTS, "too_many_requests").into_response();
    }

    let cap_tok = req.captcha_token.clone().unwrap_or_default();
    let cap_ans = req.captcha_answer.clone().unwrap_or_default();
    if cap_tok.trim().is_empty() || cap_ans.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "captcha_required").into_response();
    }
    if !captcha_verify(&state, &cap_tok, &cap_ans, client_ip.clone()) {
        return err(StatusCode::BAD_REQUEST, "captcha_failed").into_response();
    }

    let row = sqlx::query(
        "SELECT id, password_hash, is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at, admin_lock_ip FROM users WHERE email = $1",
    )
        .bind(&email)
        .fetch_optional(&state.pool)
        .await;

    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_credentials").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let user_id: Uuid = row.get("id");
    let password_hash: String = row.get("password_hash");
    let is_admin: bool = row.get("is_admin");
    let is_moderator: bool = row.try_get("is_moderator").unwrap_or(false);
    let is_founder: bool = row.try_get("is_founder").unwrap_or(false);
    let discount_percent: Option<i32> = row.try_get("discount_percent").ok().flatten();
    let discount_label: Option<String> = row.try_get("discount_label").ok().flatten();
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();
    let admin_lock_ip: Option<String> = row.try_get("admin_lock_ip").ok().flatten();
    if !verify_password(&req.password, &password_hash) {
        return err(StatusCode::UNAUTHORIZED, "invalid_credentials").into_response();
    }

    if is_admin {
        let ip = match client_ip.clone() {
            Some(v) => v,
            None => return err(StatusCode::FORBIDDEN, "admin_ip_required").into_response(),
        };
        if let Some(locked) = admin_lock_ip.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            if locked != ip {
                return err(StatusCode::FORBIDDEN, "admin_ip_locked").into_response();
            }
        } else {
            let now = OffsetDateTime::now_utc();
            let _ = sqlx::query("UPDATE users SET admin_lock_ip = $1, admin_lock_at = $2 WHERE id = $3 AND admin_lock_ip IS NULL")
                .bind(&ip)
                .bind(now)
                .bind(user_id)
                .execute(&state.pool)
                .await;
        }
    }

    if let Some(ip) = client_ip.clone() {
        let _ = sqlx::query("UPDATE users SET last_ip = $1 WHERE id = $2")
            .bind(ip)
            .bind(user_id)
            .execute(&state.pool)
            .await;
    }

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let tokens = issue_tokens(
        &state,
        user_id,
        &email,
        client_ip,
        user_agent,
        is_admin,
        is_moderator,
        is_founder,
        discount_percent,
        discount_label,
        discount_expires_at,
    )
    .await;
    match tokens {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "token_error").into_response(),
    }
}

async fn refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<RefreshRequest>,
) -> axum::response::Response {
    if req.refresh_token.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "invalid_refresh_token").into_response();
    }

    let now = OffsetDateTime::now_utc();
    let hash = sha256_hex(req.refresh_token.as_bytes());

    let row = sqlx::query(
        r#"
      SELECT
        s.id,
        s.user_id,
        u.email,
        u.is_admin,
        u.is_moderator,
        u.is_founder,
        u.discount_percent,
        u.discount_label,
        u.discount_expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1
    "#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await;

    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_refresh_token").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let session_id: Uuid = row.get("id");
    let user_id: Uuid = row.get("user_id");
    let email: String = row.get("email");
    let is_admin: bool = row.get("is_admin");
    let is_moderator: bool = row.try_get("is_moderator").unwrap_or(false);
    let is_founder: bool = row.try_get("is_founder").unwrap_or(false);
    let discount_percent: Option<i32> = row.try_get("discount_percent").ok().flatten();
    let discount_label: Option<String> = row.try_get("discount_label").ok().flatten();
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();

    let new_refresh = random_token_urlsafe(48);
    let new_hash = sha256_hex(new_refresh.as_bytes());
    let expires_at = now + Duration::days(state.cfg.refresh_token_ttl_days);
    let client_ip = get_client_ip(&headers, connect_info);
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let updated = sqlx::query(
        r#"
      UPDATE sessions
      SET refresh_token_hash = $1, last_used_at = $2, expires_at = $3, client_ip = $4, user_agent = $5
      WHERE id = $6
    "#,
    )
    .bind(&new_hash)
    .bind(now)
    .bind(expires_at)
    .bind(client_ip)
    .bind(user_agent)
    .bind(session_id)
    .execute(&state.pool)
    .await;

    if updated.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let access = issue_access_token(&state, user_id, &email);
    match access {
        Ok(access_token) => (
            StatusCode::OK,
            Json(AuthResponse {
                access_token,
                refresh_token: new_refresh,
                user: UserInfo {
                    id: user_id.to_string(),
                    email,
                    created_at: None,
                    display_name: None,
                    avatar_data_url: None,
                    is_admin,
                    is_moderator,
                    is_founder,
                    discount_percent,
                    discount_label,
                    discount_expires_at: discount_expires_at.map(|t| {
                        t.format(&time::format_description::well_known::Rfc3339)
                            .unwrap_or_default()
                    }),
                    password_changed_at: None,
                },
            }),
        )
            .into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "token_error").into_response(),
    }
}

async fn logout(
    State(state): State<AppState>,
    Json(req): Json<LogoutRequest>,
) -> axum::response::Response {
    if req.refresh_token.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "invalid_refresh_token").into_response();
    }
    let hash = sha256_hex(req.refresh_token.as_bytes());
    let now = OffsetDateTime::now_utc();

    let res = sqlx::query(
        "UPDATE sessions SET revoked_at = $1 WHERE refresh_token_hash = $2 AND revoked_at IS NULL",
    )
    .bind(now)
    .bind(hash)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn logout_all(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let now = OffsetDateTime::now_utc();
    let res = sqlx::query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL")
        .bind(now)
        .bind(user_id)
        .execute(&state.pool)
        .await;
    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn change_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<ChangePasswordRequest>,
) -> axum::response::Response {
    if req.new_password.len() < 8 {
        return err(StatusCode::BAD_REQUEST, "weak_password").into_response();
    }
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query(
        "SELECT email, password_hash, is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_token").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let email: String = row.get("email");
    let password_hash: String = row.get("password_hash");
    if !verify_password(&req.current_password, &password_hash) {
        return err(StatusCode::UNAUTHORIZED, "invalid_credentials").into_response();
    }
    let is_admin: bool = row.get("is_admin");
    let is_moderator: bool = row.try_get("is_moderator").unwrap_or(false);
    let is_founder: bool = row.try_get("is_founder").unwrap_or(false);
    let discount_percent: Option<i32> = row.try_get("discount_percent").ok().flatten();
    let discount_label: Option<String> = row.try_get("discount_label").ok().flatten();
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();

    let new_hash = match hash_password(&req.new_password) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    let updated = sqlx::query("UPDATE users SET password_hash = $1, password_changed_at = $2 WHERE id = $3")
        .bind(new_hash)
        .bind(now)
        .bind(user_id)
        .execute(&state.pool)
        .await;
    if updated.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    let _ = sqlx::query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL")
        .bind(now)
        .bind(user_id)
        .execute(&state.pool)
        .await;

    let client_ip = get_client_ip(&headers, connect_info);
    if let Some(ip) = client_ip.clone() {
        let _ = sqlx::query("UPDATE users SET last_ip = $1 WHERE id = $2")
            .bind(ip)
            .bind(user_id)
            .execute(&state.pool)
            .await;
    }
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let tokens = issue_tokens(
        &state,
        user_id,
        &email,
        client_ip,
        user_agent,
        is_admin,
        is_moderator,
        is_founder,
        discount_percent,
        discount_label,
        discount_expires_at,
    )
    .await;
    match tokens {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "token_error").into_response(),
    }
}

async fn me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let token = match bearer_token(&headers) {
        Some(t) => t,
        None => return err(StatusCode::UNAUTHORIZED, "missing_token").into_response(),
    };

    let claims = match decode_access_token(&state, &token) {
        Ok(c) => c,
        Err(code) => return err(code, "invalid_token").into_response(),
    };

    let user_id = match Uuid::parse_str(&claims.sub) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "invalid_token").into_response(),
    };

    let row = sqlx::query(
        "SELECT id, email, created_at, display_name, avatar_data_url, is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at, password_changed_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;

    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_token").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let id: Uuid = row.get("id");
    let email: String = row.get("email");
    let created_at: sqlx::types::time::OffsetDateTime = row.get("created_at");
    let display_name: Option<String> = row.try_get("display_name").unwrap_or(None);
    let avatar_data_url: Option<String> = row.try_get("avatar_data_url").unwrap_or(None);
    let is_admin: bool = row.try_get("is_admin").unwrap_or(false);
    let is_moderator: bool = row.try_get("is_moderator").unwrap_or(false);
    let is_founder: bool = row.try_get("is_founder").unwrap_or(false);
    let discount_percent: Option<i32> = row.try_get("discount_percent").ok().flatten();
    let discount_label: Option<String> = row.try_get("discount_label").ok().flatten();
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();
    let password_changed_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("password_changed_at").ok().flatten();
    (
        StatusCode::OK,
        Json(UserInfo {
            id: id.to_string(),
            email,
            created_at: Some(
                created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
            ),
            display_name,
            avatar_data_url,
            is_admin,
            is_moderator,
            is_founder,
            discount_percent,
            discount_label,
            discount_expires_at: discount_expires_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            password_changed_at: password_changed_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
        }),
    )
        .into_response()
}

async fn update_profile(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<UpdateProfileRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let display_name = req.display_name.map(|s| s.trim().to_string());
    if let Some(ref v) = display_name {
        if v.len() > 64 {
            return err(StatusCode::BAD_REQUEST, "display_name_too_long").into_response();
        }
    }

    let avatar_data_url = req.avatar_data_url.map(|s| s.trim().to_string());
    if let Some(ref v) = avatar_data_url {
        if !v.is_empty() {
            if !v.starts_with("data:image/") {
                return err(StatusCode::BAD_REQUEST, "invalid_avatar").into_response();
            }
            if v.len() > 200_000 {
                return err(StatusCode::BAD_REQUEST, "avatar_too_large").into_response();
            }
        }
    }

    let res = sqlx::query(
        r#"
      UPDATE users
      SET
        display_name = COALESCE($1, display_name),
        avatar_data_url = COALESCE($2, avatar_data_url)
      WHERE id = $3
    "#,
    )
    .bind(display_name)
    .bind(avatar_data_url)
    .bind(user_id)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn entitlements(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query(
    "UPDATE subscriptions SET status = 'expired', canceled_at = $1 WHERE user_id = $2 AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= $1",
  )
  .bind(now)
  .bind(user_id)
  .execute(&state.pool)
  .await;

    let trial_used_row = sqlx::query(
        r#"
      SELECT 1
      FROM subscriptions s
      JOIN products p ON p.id = s.product_id
      WHERE s.user_id = $1
        AND p.code = 'kivana'
        AND s.trial_ends_at IS NOT NULL
      LIMIT 1
    "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;
    let trial_eligible = matches!(trial_used_row, Ok(None));

    let rows = sqlx::query(
        r#"
      SELECT
        p.code AS product_code,
        pl.code AS plan_code,
        pl.name AS plan_name,
        s.status AS status,
        s.ends_at AS ends_at,
        s.trial_ends_at AS trial_ends_at
      FROM subscriptions s
      JOIN products p ON p.id = s.product_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.user_id = $1
        AND s.status = 'active'
        AND (s.ends_at IS NULL OR s.ends_at > now())
      ORDER BY p.code ASC
    "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut products: Vec<ProductEntitlement> = Vec::new();
    for r in rows {
        let product_code: String = r.get("product_code");
        let plan_code: String = r.get("plan_code");
        let plan_name: String = r.get("plan_name");
        let status: String = r.get("status");
        let ends_at: Option<sqlx::types::time::OffsetDateTime> = r.try_get("ends_at").ok();
        let trial_ends_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("trial_ends_at").ok();
        let is_trial = trial_ends_at.map(|t| t > now).unwrap_or(false);
        let feature_rows = sqlx::query(
            r#"
        SELECT f.code AS code
        FROM plan_features pf
        JOIN features f ON f.id = pf.feature_id
        JOIN plans pl ON pl.id = pf.plan_id
        JOIN products p ON p.id = pl.product_id
        WHERE p.code = $1 AND pl.code = $2
        ORDER BY f.code ASC
      "#,
        )
        .bind(&product_code)
        .bind(&plan_code)
        .fetch_all(&state.pool)
        .await;

        let features: Vec<String> = match feature_rows {
            Ok(v) => v.into_iter().map(|x| x.get::<String, _>("code")).collect(),
            Err(_) => Vec::new(),
        };

        let is_kivana_product = product_code == "kivana";
        products.push(ProductEntitlement {
            product_code,
            plan_code,
            plan_name,
            status,
            ends_at: ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            trial_ends_at: trial_ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            is_trial,
            trial_eligible: if is_kivana_product { trial_eligible } else { false },
            features,
        });
    }

    let has_kivana = products
        .iter()
        .any(|p| p.product_code.trim().to_lowercase() == "kivana");
    if !has_kivana {
        let feature_rows = sqlx::query(
            r#"
        SELECT f.code AS code
        FROM plan_features pf
        JOIN features f ON f.id = pf.feature_id
        JOIN plans pl ON pl.id = pf.plan_id
        JOIN products p ON p.id = pl.product_id
        WHERE p.code = 'kivana' AND pl.code = 'basic'
        ORDER BY f.code ASC
      "#,
        )
        .fetch_all(&state.pool)
        .await;
        let features: Vec<String> = match feature_rows {
            Ok(v) => v.into_iter().map(|x| x.get::<String, _>("code")).collect(),
            Err(_) => Vec::new(),
        };

        products.push(ProductEntitlement {
            product_code: "kivana".to_string(),
            plan_code: "basic".to_string(),
            plan_name: "Basic".to_string(),
            status: "free".to_string(),
            ends_at: None,
            trial_ends_at: None,
            is_trial: false,
            trial_eligible,
            features,
        });
    }

    (StatusCode::OK, Json(EntitlementsResponse { products })).into_response()
}

async fn list_sessions(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let rows = sqlx::query(
        r#"
      SELECT id, created_at, last_used_at, expires_at, client_ip, user_agent
      FROM sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY last_used_at DESC
      LIMIT 50
    "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let sessions = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
            let last_used_at: sqlx::types::time::OffsetDateTime = r.get("last_used_at");
            let expires_at: sqlx::types::time::OffsetDateTime = r.get("expires_at");
            let client_ip: Option<String> = r.try_get("client_ip").ok().flatten();
            let user_agent: Option<String> = r.try_get("user_agent").ok().flatten();
            SessionInfo {
                id: id.to_string(),
                created_at: created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                last_used_at: last_used_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                expires_at: expires_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                client_ip,
                user_agent,
            }
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(SessionsResponse { sessions })).into_response()
}

async fn revoke_session(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let now = OffsetDateTime::now_utc();
    let res = sqlx::query(
        "UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
    )
    .bind(now)
    .bind(id)
    .bind(user_id)
    .execute(&state.pool)
    .await;
    match res {
        Ok(r) if r.rows_affected() > 0 => {
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "session_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn account_export(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let row = sqlx::query(
        "SELECT id, email, created_at, display_name, avatar_data_url, is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at, password_changed_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_token").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let created_at: sqlx::types::time::OffsetDateTime = row.get("created_at");
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();
    let password_changed_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("password_changed_at").ok().flatten();

    let user = UserInfo {
        id: row.get::<Uuid, _>("id").to_string(),
        email: row.get::<String, _>("email"),
        created_at: Some(
            created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        ),
        display_name: row.try_get("display_name").unwrap_or(None),
        avatar_data_url: row.try_get("avatar_data_url").unwrap_or(None),
        is_admin: row.try_get("is_admin").unwrap_or(false),
        is_moderator: row.try_get("is_moderator").unwrap_or(false),
        is_founder: row.try_get("is_founder").unwrap_or(false),
        discount_percent: row.try_get("discount_percent").ok().flatten(),
        discount_label: row.try_get("discount_label").ok().flatten(),
        discount_expires_at: discount_expires_at.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        password_changed_at: password_changed_at.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
    };

    let trial_used_row = sqlx::query(
        r#"
      SELECT 1
      FROM subscriptions s
      JOIN products p ON p.id = s.product_id
      WHERE s.user_id = $1
        AND p.code = 'kivana'
        AND s.trial_ends_at IS NOT NULL
      LIMIT 1
    "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;
    let trial_eligible = matches!(trial_used_row, Ok(None));

    let rows = sqlx::query(
        r#"
      SELECT
        p.code AS product_code,
        pl.code AS plan_code,
        pl.name AS plan_name,
        s.status AS status,
        s.ends_at AS ends_at,
        s.trial_ends_at AS trial_ends_at
      FROM subscriptions s
      JOIN products p ON p.id = s.product_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.user_id = $1
        AND s.status = 'active'
        AND (s.ends_at IS NULL OR s.ends_at > now())
      ORDER BY p.code ASC
    "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    let mut products: Vec<ProductEntitlement> = Vec::new();
    for r in rows {
        let product_code: String = r.get("product_code");
        let plan_code: String = r.get("plan_code");
        let plan_name: String = r.get("plan_name");
        let status: String = r.get("status");
        let ends_at: Option<sqlx::types::time::OffsetDateTime> = r.try_get("ends_at").ok();
        let trial_ends_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("trial_ends_at").ok();
        let is_trial = trial_ends_at.map(|t| t > now).unwrap_or(false);
        products.push(ProductEntitlement {
            product_code: product_code.clone(),
            plan_code,
            plan_name,
            status,
            ends_at: ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            trial_ends_at: trial_ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            is_trial,
            trial_eligible: if product_code == "kivana" { trial_eligible } else { false },
            features: Vec::new(),
        });
    }
    if !products
        .iter()
        .any(|p| p.product_code.trim().to_lowercase() == "kivana")
    {
        products.push(ProductEntitlement {
            product_code: "kivana".to_string(),
            plan_code: "basic".to_string(),
            plan_name: "Basic".to_string(),
            status: "free".to_string(),
            ends_at: None,
            trial_ends_at: None,
            is_trial: false,
            trial_eligible,
            features: Vec::new(),
        });
    }

    let entitlements = EntitlementsResponse { products };

    let sessions_rows = sqlx::query(
        r#"
      SELECT id, created_at, last_used_at, expires_at, client_ip, user_agent
      FROM sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY last_used_at DESC
      LIMIT 50
    "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await;
    let sessions_rows = match sessions_rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let sessions = sessions_rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
            let last_used_at: sqlx::types::time::OffsetDateTime = r.get("last_used_at");
            let expires_at: sqlx::types::time::OffsetDateTime = r.get("expires_at");
            let client_ip: Option<String> = r.try_get("client_ip").ok().flatten();
            let user_agent: Option<String> = r.try_get("user_agent").ok().flatten();
            SessionInfo {
                id: id.to_string(),
                created_at: created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                last_used_at: last_used_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                expires_at: expires_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                client_ip,
                user_agent,
            }
        })
        .collect::<Vec<_>>();

    (
        StatusCode::OK,
        Json(AccountExportResponse {
            user,
            entitlements,
            sessions,
        }),
    )
        .into_response()
}

async fn delete_account(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<DeleteAccountRequest>,
) -> axum::response::Response {
    if req.confirm_text.trim() != "DELETE" {
        return err(StatusCode::BAD_REQUEST, "confirm_required").into_response();
    }
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let row = sqlx::query("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "invalid_token").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let password_hash: String = row.get("password_hash");
    if !verify_password(&req.password, &password_hash) {
        return err(StatusCode::UNAUTHORIZED, "invalid_credentials").into_response();
    }
    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL")
        .bind(now)
        .bind(user_id)
        .execute(&state.pool)
        .await;
    let res = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await;
    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectPlanRequest {
    plan_code: String,
    billing_cycle: Option<String>,
}

async fn portal_select_plan(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SelectPlanRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let valid_plans = ["basic", "trial", "standard", "pro", "lifetime_pro"];
    if !valid_plans.contains(&req.plan_code.as_str()) {
        return err(StatusCode::BAD_REQUEST, "invalid_plan").into_response();
    }

    let product_code = "kivana";
    let plan_code = req.plan_code.trim().to_lowercase();
    let billing_cycle = req
        .billing_cycle
        .clone()
        .unwrap_or_else(|| "monthly".to_string())
        .trim()
        .to_lowercase();
    let valid_cycles = ["monthly", "yearly"];
    if !valid_cycles.contains(&billing_cycle.as_str()) {
        return err(StatusCode::BAD_REQUEST, "invalid_billing_cycle").into_response();
    }

    let prod_row = sqlx::query("SELECT id FROM products WHERE code = $1")
        .bind(product_code)
        .fetch_optional(&state.pool)
        .await;
    let product_id: Uuid = match prod_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::NOT_FOUND, "product_not_found").into_response(),
    };

    let is_trial_request = plan_code == "trial";
    if is_trial_request {
        let used = sqlx::query(
            "SELECT 1 FROM subscriptions WHERE user_id = $1 AND product_id = $2 AND trial_ends_at IS NOT NULL LIMIT 1",
        )
        .bind(user_id)
        .bind(product_id)
        .fetch_optional(&state.pool)
        .await;
        match used {
            Ok(Some(_)) => return err(StatusCode::FORBIDDEN, "trial_already_used").into_response(),
            Ok(None) => {}
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        }
    }

    let plan_code_to_lookup = if is_trial_request {
        "standard".to_string()
    } else {
        plan_code.clone()
    };

    let paypal_cfg = get_paypal_config(&state.pool).await;
    if paypal_cfg.enabled && (plan_code_to_lookup == "standard" || plan_code_to_lookup == "pro") {
        return err(StatusCode::PAYMENT_REQUIRED, "payment_required").into_response();
    }
    let plan_id = if plan_code == "basic" {
        None
    } else {
        let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = $2")
            .bind(product_id)
            .bind(&plan_code_to_lookup)
            .fetch_optional(&state.pool)
            .await;
        match plan_row {
            Ok(Some(r)) => Some(r.get::<Uuid, _>("id")),
            _ => return err(StatusCode::NOT_FOUND, "plan_not_found").into_response(),
        }
    };

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let now = OffsetDateTime::now_utc();

    if plan_code == "basic" && paypal_cfg.enabled {
        let row = sqlx::query(
            "SELECT provider_subscription_id FROM subscriptions WHERE user_id = $1 AND product_id = $2 AND status = 'active' AND provider = 'paypal' AND provider_subscription_id IS NOT NULL ORDER BY started_at DESC LIMIT 1",
        )
        .bind(user_id)
        .bind(product_id)
        .fetch_optional(&mut *tx)
        .await;
        if let Ok(Some(r)) = row {
            let sub_id: String = r.get("provider_subscription_id");
            if !sub_id.trim().is_empty() && !paypal_cfg.client_id.trim().is_empty() && !paypal_cfg.secret.trim().is_empty() {
                if let Ok(tok) = paypal_access_token(&paypal_cfg).await {
                    let _ = paypal_cancel_subscription(&paypal_cfg, &tok, &sub_id, "User canceled via portal").await;
                }
            }
        }
    }

    let _ = sqlx::query("UPDATE subscriptions SET status = 'canceled', canceled_at = $1 WHERE user_id = $2 AND product_id = $3 AND status = 'active'")
        .bind(now)
        .bind(user_id)
        .bind(product_id)
        .execute(&mut *tx)
        .await;

    if plan_code != "basic" {
        let (ends_at, trial_ends_at) = if is_trial_request {
            let trial_end = now + Duration::days(14);
            (Some(trial_end), Some(trial_end))
        } else {
            match plan_code_to_lookup.as_str() {
                "standard" | "pro" => {
                    let days = if billing_cycle == "yearly" { 365 } else { 30 };
                    (Some(now + Duration::days(days)), None)
                }
                "lifetime_pro" => (None, None),
                _ => (None, None),
            }
        };

        let inserted = sqlx::query(
            "INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, ends_at, trial_ends_at) VALUES ($1,$2,$3,$4,'active',$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(product_id)
        .bind(plan_id.unwrap_or_else(|| Uuid::nil()))
        .bind(now)
        .bind(ends_at)
        .bind(trial_ends_at)
        .execute(&mut *tx)
        .await;

        if inserted.is_err() {
            return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
        }
    }

    if tx.commit().await.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    // Send real-time event to the desktop app
    let _ = state.tx_events.send(UserEvent {
        user_id: user_id.to_string(),
        event_type: "entitlements_updated".to_string(),
    });

    (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
}

async fn paypal_cancel_subscription(
    cfg: &PayPalConfig,
    token: &str,
    subscription_id: &str,
    reason: &str,
) -> anyhow::Result<()> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let res = client
        .post(format!(
            "{}/v1/billing/subscriptions/{}/cancel",
            base,
            subscription_id
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({ "reason": reason }))
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_cancel_failed");
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortalPayPalStartRequest {
    plan_code: String,
    billing_cycle: String,
    currency: String,
    return_url: String,
    cancel_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortalPayPalStartResponse {
    approval_url: String,
    subscription_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortalPayPalConfirmRequest {
    subscription_id: String,
}

#[derive(Deserialize)]
struct PayPalLink {
    rel: String,
    href: String,
}

#[derive(Deserialize)]
struct PayPalCreateSubscriptionResponse {
    id: String,
    links: Vec<PayPalLink>,
}

#[derive(Deserialize)]
struct PayPalBillingInfo {
    next_billing_time: Option<String>,
}

#[derive(Deserialize)]
struct PayPalSubscriptionDetails {
    id: String,
    status: String,
    billing_info: Option<PayPalBillingInfo>,
    plan_id: Option<String>,
}

fn paypal_plan_id_for(cfg: &PayPalConfig, plan_code: &str, billing_cycle: &str, currency: &str) -> Option<String> {
    let cur = currency.trim().to_uppercase();
    let k = if cur == "NOK" { "nok" } else if cur == "GBP" { "gbp" } else { "eur" };
    let cycle = billing_cycle.trim().to_lowercase();
    let plan = plan_code.trim().to_lowercase();
    let cycles = if plan == "standard" { &cfg.plans.standard } else if plan == "pro" { &cfg.plans.pro } else { return None };
    let cc = if cycle == "yearly" { &cycles.yearly } else { &cycles.monthly };
    if k == "eur" { cc.eur.clone() } else if k == "gbp" { cc.gbp.clone() } else { cc.nok.clone() }
}

async fn paypal_create_subscription(
    cfg: &PayPalConfig,
    token: &str,
    paypal_plan_id: &str,
    return_url: &str,
    cancel_url: &str,
) -> anyhow::Result<PortalPayPalStartResponse> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(12))
        .build()?;
    let res = client
        .post(format!("{}/v1/billing/subscriptions", base))
        .bearer_auth(token)
        .json(&serde_json::json!({
          "plan_id": paypal_plan_id,
          "application_context": {
            "brand_name": "Kivana",
            "user_action": "SUBSCRIBE_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url
          }
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_subscription_failed");
    }
    let json = res.json::<PayPalCreateSubscriptionResponse>().await?;
    let approve = json
        .links
        .iter()
        .find(|l| l.rel.trim().to_lowercase() == "approve")
        .map(|l| l.href.clone())
        .unwrap_or_default();
    if approve.trim().is_empty() {
        anyhow::bail!("paypal_subscription_failed");
    }
    Ok(PortalPayPalStartResponse {
        approval_url: approve,
        subscription_id: json.id,
    })
}

async fn paypal_get_subscription_details(
    cfg: &PayPalConfig,
    token: &str,
    subscription_id: &str,
) -> anyhow::Result<PayPalSubscriptionDetails> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let res = client
        .get(format!(
            "{}/v1/billing/subscriptions/{}",
            base, subscription_id
        ))
        .bearer_auth(token)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("paypal_subscription_not_found");
    }
    Ok(res.json::<PayPalSubscriptionDetails>().await?)
}

async fn portal_paypal_start(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<PortalPayPalStartRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let plan_code = req.plan_code.trim().to_lowercase();
    if plan_code != "standard" && plan_code != "pro" {
        return err(StatusCode::BAD_REQUEST, "invalid_plan").into_response();
    }
    let billing_cycle = req.billing_cycle.trim().to_lowercase();
    if billing_cycle != "monthly" && billing_cycle != "yearly" {
        return err(StatusCode::BAD_REQUEST, "invalid_billing_cycle").into_response();
    }
    let currency = req.currency.trim().to_uppercase();
    if currency != "EUR" && currency != "GBP" && currency != "NOK" {
        return err(StatusCode::BAD_REQUEST, "invalid_currency").into_response();
    }
    let paypal_cfg = get_paypal_config(&state.pool).await;
    if !paypal_cfg.enabled {
        return err(StatusCode::BAD_REQUEST, "paypal_disabled").into_response();
    }
    if paypal_cfg.client_id.trim().is_empty() || paypal_cfg.secret.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "paypal_not_configured").into_response();
    }
    let paypal_plan_id = match paypal_plan_id_for(&paypal_cfg, &plan_code, &billing_cycle, &currency) {
        Some(v) if !v.trim().is_empty() => v,
        _ => return err(StatusCode::BAD_REQUEST, "paypal_plan_missing").into_response(),
    };

    let product_code = "kivana";
    let prod_row = sqlx::query("SELECT id FROM products WHERE code = $1")
        .bind(product_code)
        .fetch_optional(&state.pool)
        .await;
    let product_id: Uuid = match prod_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::NOT_FOUND, "product_not_found").into_response(),
    };
    let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = $2")
        .bind(product_id)
        .bind(&plan_code)
        .fetch_optional(&state.pool)
        .await;
    let internal_plan_id: Uuid = match plan_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::NOT_FOUND, "plan_not_found").into_response(),
    };

    let tok = match paypal_access_token(&paypal_cfg).await {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_auth_failed").into_response(),
    };
    let created = match paypal_create_subscription(
        &paypal_cfg,
        &tok,
        &paypal_plan_id,
        &req.return_url,
        &req.cancel_url,
    )
    .await
    {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_subscription_failed").into_response(),
    };

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query("UPDATE subscriptions SET status = 'canceled', canceled_at = $1 WHERE user_id = $2 AND product_id = $3 AND status = 'active'")
        .bind(now)
        .bind(user_id)
        .bind(product_id)
        .execute(&mut *tx)
        .await;
    let inserted = sqlx::query(
        r#"INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, ends_at, trial_ends_at, provider, provider_subscription_id, provider_plan_id, billing_cycle, currency, provider_status, provider_last_event_at)
           VALUES ($1,$2,$3,$4,'pending',$5,NULL,NULL,'paypal',$6,$7,$8,$9,$10,$11)"#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(product_id)
    .bind(internal_plan_id)
    .bind(now)
    .bind(&created.subscription_id)
    .bind(&paypal_plan_id)
    .bind(&billing_cycle)
    .bind(&currency)
    .bind("APPROVAL_PENDING")
    .bind(now)
    .execute(&mut *tx)
    .await;
    if inserted.is_err() || tx.commit().await.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    (StatusCode::OK, Json(created)).into_response()
}

async fn portal_paypal_confirm(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<PortalPayPalConfirmRequest>,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let subscription_id = req.subscription_id.trim().to_string();
    if subscription_id.is_empty() {
        return err(StatusCode::BAD_REQUEST, "invalid_subscription").into_response();
    }
    let paypal_cfg = get_paypal_config(&state.pool).await;
    if !paypal_cfg.enabled {
        return err(StatusCode::BAD_REQUEST, "paypal_disabled").into_response();
    }
    let tok = match paypal_access_token(&paypal_cfg).await {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_auth_failed").into_response(),
    };
    let details = match paypal_get_subscription_details(&paypal_cfg, &tok, &subscription_id).await {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "paypal_subscription_not_found").into_response(),
    };
    let now = OffsetDateTime::now_utc();
    let status = details.status.trim().to_uppercase();
    let ends_at = details
        .billing_info
        .as_ref()
        .and_then(|b| b.next_billing_time.clone())
        .and_then(|s| OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok());
    let next_state = if status == "ACTIVE" { "active" } else { "pending" };
    let res = sqlx::query(
        "UPDATE subscriptions SET status = $1, provider_status = $2, ends_at = COALESCE($3, ends_at), provider_last_event_at = $4 WHERE user_id = $5 AND provider = 'paypal' AND provider_subscription_id = $6",
    )
    .bind(next_state)
    .bind(&status)
    .bind(ends_at)
    .bind(now)
    .bind(user_id)
    .bind(&subscription_id)
    .execute(&state.pool)
    .await;
    if res.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }
    let _ = state.tx_events.send(UserEvent {
        user_id: user_id.to_string(),
        event_type: "entitlements_updated".to_string(),
    });
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "status": status }))).into_response()
}

#[derive(Deserialize)]
struct PayPalVerifyWebhookResponse {
    verification_status: String,
}

async fn paypal_verify_webhook(
    cfg: &PayPalConfig,
    token: &str,
    webhook_id: &str,
    headers: &axum::http::HeaderMap,
    event: &serde_json::Value,
) -> anyhow::Result<bool> {
    let base = paypal_base_url(cfg.mode.as_str());
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(10))
        .build()?;
    let auth_algo = headers
        .get("PAYPAL-AUTH-ALGO")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let cert_url = headers
        .get("PAYPAL-CERT-URL")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let transmission_id = headers
        .get("PAYPAL-TRANSMISSION-ID")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let transmission_sig = headers
        .get("PAYPAL-TRANSMISSION-SIG")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let transmission_time = headers
        .get("PAYPAL-TRANSMISSION-TIME")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if auth_algo.is_empty()
        || cert_url.is_empty()
        || transmission_id.is_empty()
        || transmission_sig.is_empty()
        || transmission_time.is_empty()
        || webhook_id.trim().is_empty()
    {
        return Ok(false);
    }
    let res = client
        .post(format!("{}/v1/notifications/verify-webhook-signature", base))
        .bearer_auth(token)
        .json(&serde_json::json!({
          "auth_algo": auth_algo,
          "cert_url": cert_url,
          "transmission_id": transmission_id,
          "transmission_sig": transmission_sig,
          "transmission_time": transmission_time,
          "webhook_id": webhook_id,
          "webhook_event": event
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        return Ok(false);
    }
    let json = res.json::<PayPalVerifyWebhookResponse>().await?;
    Ok(json.verification_status.trim().to_uppercase() == "SUCCESS")
}

async fn paypal_webhook(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    let paypal_cfg = get_paypal_config(&state.pool).await;
    if paypal_cfg.client_id.trim().is_empty() || paypal_cfg.secret.trim().is_empty() {
        return StatusCode::NO_CONTENT.into_response();
    }
    let event: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let tok = match paypal_access_token(&paypal_cfg).await {
        Ok(v) => v,
        Err(_) => return StatusCode::NO_CONTENT.into_response(),
    };
    let ok = match paypal_verify_webhook(&paypal_cfg, &tok, &paypal_cfg.webhook_id, &headers, &event).await {
        Ok(v) => v,
        Err(_) => false,
    };
    if !ok {
        return StatusCode::NO_CONTENT.into_response();
    }

    let event_type = event
        .get("event_type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let resource = event.get("resource").cloned().unwrap_or(serde_json::json!({}));
    let sub_id = resource.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if sub_id.trim().is_empty() {
        return StatusCode::NO_CONTENT.into_response();
    }
    let status = resource
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_uppercase();
    let next_billing_time = resource
        .get("billing_info")
        .and_then(|b| b.get("next_billing_time"))
        .and_then(|v| v.as_str())
        .and_then(|s| OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok());
    let now = OffsetDateTime::now_utc();

    let next_state = if status == "ACTIVE" { "active" } else if status == "CANCELLED" || status == "SUSPENDED" || status == "EXPIRED" { "canceled" } else { "pending" };
    let _ = sqlx::query(
        "UPDATE subscriptions SET status = $1, provider_status = $2, ends_at = COALESCE($3, ends_at), provider_last_event_at = $4 WHERE provider = 'paypal' AND provider_subscription_id = $5",
    )
    .bind(next_state)
    .bind(&status)
    .bind(next_billing_time)
    .bind(now)
    .bind(&sub_id)
    .execute(&state.pool)
    .await;

    let user_row = sqlx::query("SELECT user_id FROM subscriptions WHERE provider = 'paypal' AND provider_subscription_id = $1 LIMIT 1")
        .bind(&sub_id)
        .fetch_optional(&state.pool)
        .await;
    if let Ok(Some(r)) = user_row {
        let user_id: Uuid = r.get("user_id");
        let _ = state.tx_events.send(UserEvent {
            user_id: user_id.to_string(),
            event_type: "entitlements_updated".to_string(),
        });
    }

    let _ = event_type;
    StatusCode::OK.into_response()
}

async fn poll_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let user_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let user_id_str = user_id.to_string();

    let mut rx = state.tx_events.subscribe();
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(30));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
          _ = &mut timeout => {
            return StatusCode::NO_CONTENT.into_response();
          }
          res = rx.recv() => {
            match res {
              Ok(event) => {
                if event.user_id == user_id_str {
                  return Json(event).into_response();
                }
              }
              Err(_) => {
                return StatusCode::NO_CONTENT.into_response();
              }
            }
          }
        }
    }
}

async fn admin_grant(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<AdminGrantRequest>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }

    let user_row = sqlx::query("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await;
    let user_id: Uuid = match user_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let product_code = req.product_code.trim().to_lowercase();
    let plan_code = req.plan_code.trim().to_lowercase();
    let is_trial = plan_code == "trial";

    let prod_row = sqlx::query("SELECT id FROM products WHERE code = $1")
        .bind(&product_code)
        .fetch_optional(&state.pool)
        .await;
    let product_id: Uuid = match prod_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return err(StatusCode::NOT_FOUND, "product_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let cfg = get_portal_config(&state.pool).await;
    if plan_code == "basic" {
        let now = OffsetDateTime::now_utc();
        let res = sqlx::query("UPDATE subscriptions SET status = 'canceled', canceled_at = $1 WHERE user_id = $2 AND product_id = $3 AND status = 'active'")
            .bind(now)
            .bind(user_id)
            .bind(product_id)
            .execute(&state.pool)
            .await;
        match res {
            Ok(_) => return (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        }
    }

    let plan_code_to_lookup = if is_trial { "standard".to_string() } else { plan_code.clone() };
    let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = $2")
        .bind(product_id)
        .bind(&plan_code_to_lookup)
        .fetch_optional(&state.pool)
        .await;
    let plan_id: Uuid = match plan_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return err(StatusCode::NOT_FOUND, "plan_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let ends_at = match req
        .ends_at
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        None => None,
        Some(s) => match OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339) {
            Ok(v) => Some(v),
            Err(_) => return err(StatusCode::BAD_REQUEST, "invalid_ends_at").into_response(),
        },
    };

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let now = OffsetDateTime::now_utc();
    let _ = sqlx::query("UPDATE subscriptions SET status = 'canceled', canceled_at = $1 WHERE user_id = $2 AND product_id = $3 AND status = 'active'")
    .bind(now)
    .bind(user_id)
    .bind(product_id)
    .execute(&mut *tx)
    .await;

    let (ends_at, trial_ends_at) = if is_trial {
        let trial_end_default = now + Duration::days(cfg.pricing.trial_days as i64);
        let end = ends_at.unwrap_or(trial_end_default);
        (Some(end), Some(end))
    } else {
        (ends_at, None)
    };

    let sub_id = Uuid::new_v4();
    let inserted = sqlx::query(
    "INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, ends_at, trial_ends_at) VALUES ($1,$2,$3,$4,'active',$5,$6,$7)",
  )
  .bind(sub_id)
  .bind(user_id)
  .bind(product_id)
  .bind(plan_id)
  .bind(now)
  .bind(ends_at)
  .bind(trial_ends_at)
  .execute(&mut *tx)
  .await;

    if inserted.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    if tx.commit().await.is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response();
    }

    // Send real-time event to the desktop app
    let _ = state.tx_events.send(UserEvent {
        user_id: user_id.to_string(),
        event_type: "entitlements_updated".to_string(),
    });

    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

async fn admin_bootstrap(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AdminBootstrapRequest>,
) -> axum::response::Response {
    let admin_token = match std::env::var("ADMIN_TOKEN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(v) => v,
        None => return err(StatusCode::NOT_FOUND, "not_found").into_response(),
    };

    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if provided.is_empty() || provided != admin_token {
        return err(StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }

    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }

    let updated = sqlx::query("UPDATE users SET is_admin = TRUE WHERE email = $1")
        .bind(&email)
        .execute(&state.pool)
        .await;
    match updated {
        Ok(r) if r.rows_affected() > 0 => {
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> axum::response::Response {
    if let Err(r) = require_staff(&state, &headers, connect_info).await {
        return r;
    }

    let rows = sqlx::query(
        r#"
      SELECT
        u.id AS id,
        u.email AS email,
        u.created_at AS created_at,
        u.password_changed_at AS password_changed_at,
        u.is_admin AS is_admin,
        u.is_moderator AS is_moderator,
        u.is_founder AS is_founder,
        u.discount_percent AS discount_percent,
        u.discount_label AS discount_label,
        u.discount_expires_at AS discount_expires_at,
        u.last_ip AS last_ip,
        pl.code AS plan_code,
        pl.name AS plan_name,
        s.ends_at AS ends_at,
        s.trial_ends_at AS trial_ends_at
      FROM users u
      LEFT JOIN subscriptions s
        ON s.user_id = u.id
       AND s.status = 'active'
       AND (s.ends_at IS NULL OR s.ends_at > now())
       AND s.product_id = (SELECT id FROM products WHERE code = 'kivana' LIMIT 1)
      LEFT JOIN plans pl ON pl.id = s.plan_id
      ORDER BY u.created_at DESC
      LIMIT 500
    "#,
    )
    .fetch_all(&state.pool)
    .await;

    let rows = match rows {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let mut users: Vec<AdminUserRow> = Vec::with_capacity(rows.len());
    for r in rows {
        let id: Uuid = r.get("id");
        let email: String = r.get("email");
        let created_at: sqlx::types::time::OffsetDateTime = r.get("created_at");
        let password_changed_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("password_changed_at").ok().flatten();
        let is_admin: bool = r.get("is_admin");
        let is_moderator: bool = r.try_get("is_moderator").unwrap_or(false);
        let is_founder: bool = r.try_get("is_founder").unwrap_or(false);
        let discount_percent: Option<i32> = r.try_get("discount_percent").ok().flatten();
        let discount_label: Option<String> = r.try_get("discount_label").ok().flatten();
        let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("discount_expires_at").ok().flatten();
        let last_ip: Option<String> = r.try_get("last_ip").ok().flatten();
        let plan_code: Option<String> = r.try_get("plan_code").ok();
        let plan_name: Option<String> = r.try_get("plan_name").ok();
        let ends_at: Option<sqlx::types::time::OffsetDateTime> = r.try_get("ends_at").ok();
        let trial_ends_at: Option<sqlx::types::time::OffsetDateTime> =
            r.try_get("trial_ends_at").ok();

        users.push(AdminUserRow {
            id: id.to_string(),
            email,
            created_at: created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            is_admin,
            is_moderator,
            is_founder,
            discount_percent,
            discount_label,
            discount_expires_at: discount_expires_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            last_ip,
            kivana_plan_code: plan_code,
            kivana_plan_name: plan_name,
            kivana_ends_at: ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            kivana_trial_ends_at: trial_ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            password_changed_at: password_changed_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
        });
    }

    (StatusCode::OK, Json(AdminUsersResponse { users })).into_response()
}

async fn admin_delete_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role == StaffRole::Moderator {
        let row = sqlx::query("SELECT is_admin FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await;
        let is_admin = match row {
            Ok(Some(r)) => r.get::<bool, _>("is_admin"),
            Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        };
        if is_admin {
            return err(StatusCode::FORBIDDEN, "forbidden").into_response();
        }
    }

    let res = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_set_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<AdminSetPasswordRequest>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role == StaffRole::Moderator {
        let row = sqlx::query("SELECT is_admin FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await;
        let is_admin = match row {
            Ok(Some(r)) => r.get::<bool, _>("is_admin"),
            Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        };
        if is_admin {
            return err(StatusCode::FORBIDDEN, "forbidden").into_response();
        }
    }
    if req.password.len() < 8 {
        return err(StatusCode::BAD_REQUEST, "weak_password").into_response();
    }

    let password_hash = match hash_password(&req.password) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed").into_response(),
    };
    let now = OffsetDateTime::now_utc();

    let updated = sqlx::query("UPDATE users SET password_hash = $1, password_changed_at = $2 WHERE id = $3")
        .bind(password_hash)
        .bind(now)
        .bind(id)
        .execute(&state.pool)
        .await;

    match updated {
        Ok(r) if r.rows_affected() > 0 => {
            let _ = sqlx::query(
                "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
            )
            .bind(now)
            .bind(id)
            .execute(&state.pool)
            .await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_set_admin_flag(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<AdminToggleFlagRequest>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role != StaffRole::Admin {
        return err(StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let caller_id = match access_user_id(&state, &headers) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if !req.enabled && caller_id == id {
        return err(StatusCode::FORBIDDEN, "cannot_demote_self").into_response();
    }

    if !req.enabled {
        let row = sqlx::query("SELECT COUNT(*)::bigint AS c FROM users WHERE is_admin = TRUE")
            .fetch_one(&state.pool)
            .await;
        let admins_count: i64 = match row {
            Ok(r) => r.try_get::<i64, _>("c").unwrap_or(1),
            Err(_) => 1,
        };
        if admins_count <= 1 {
            return err(StatusCode::FORBIDDEN, "cannot_remove_last_admin").into_response();
        }
    }

    let res = sqlx::query("UPDATE users SET is_admin = $1 WHERE id = $2")
        .bind(req.enabled)
        .bind(id)
        .execute(&state.pool)
        .await;
    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_set_founder_flag(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<AdminToggleFlagRequest>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role != StaffRole::Admin {
        return err(StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    if req.enabled {
        let row = sqlx::query("SELECT is_admin FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await;
        let is_admin: bool = match row {
            Ok(Some(r)) => r.try_get("is_admin").unwrap_or(false),
            Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        };
        if is_admin {
            return err(StatusCode::FORBIDDEN, "forbidden").into_response();
        }
    }

    let res = sqlx::query("UPDATE users SET is_founder = $1 WHERE id = $2")
        .bind(req.enabled)
        .bind(id)
        .execute(&state.pool)
        .await;
    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_set_moderator(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<AdminSetModeratorRequest>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role != StaffRole::Admin {
        return err(StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }

    let row = sqlx::query("SELECT id, is_admin FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };
    let id: Uuid = row.get("id");
    let is_admin: bool = row.get("is_admin");
    if is_admin {
        return err(StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let res = sqlx::query("UPDATE users SET is_moderator = $1 WHERE id = $2")
        .bind(req.enabled)
        .bind(id)
        .execute(&state.pool)
        .await;
    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

async fn admin_set_discount(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(req): Json<AdminSetDiscountRequest>,
) -> axum::response::Response {
    let role = match require_staff(&state, &headers, connect_info).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if role != StaffRole::Admin {
        return err(StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let email = normalize_email(&req.email);
    if !is_valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "invalid_email").into_response();
    }
    if req.percent < 0 || req.percent > 90 {
        return err(StatusCode::BAD_REQUEST, "invalid_discount").into_response();
    }
    if let Some(ref label) = req.label {
        if label.trim().len() > 64 {
            return err(StatusCode::BAD_REQUEST, "invalid_discount").into_response();
        }
    }

    let user_row = sqlx::query("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await;
    let user_id: Uuid = match user_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return err(StatusCode::NOT_FOUND, "user_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let percent: Option<i32> = if req.percent == 0 { None } else { Some(req.percent) };
    let label: Option<String> = percent.as_ref().map(|_| {
        req.label
            .clone()
            .unwrap_or_else(|| "discount".to_string())
            .trim()
            .to_string()
    });
    let res = if percent.is_none() {
        sqlx::query("UPDATE users SET discount_percent = NULL, discount_label = NULL, discount_expires_at = NULL WHERE id = $1")
            .bind(user_id)
            .execute(&state.pool)
            .await
    } else {
        sqlx::query("UPDATE users SET discount_percent = $1, discount_label = $2 WHERE id = $3")
            .bind(percent)
            .bind(label)
            .bind(user_id)
            .execute(&state.pool)
            .await
    };
    match res {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    }
}

fn err(status: StatusCode, code: &str) -> impl IntoResponse {
    (
        status,
        Json(ErrorResponse {
            error: code.to_string(),
        }),
    )
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn is_valid_email(email: &str) -> bool {
    let s = email.trim();
    if s.len() < 3 || s.len() > 320 {
        return false;
    }
    let at = match s.find('@') {
        Some(v) => v,
        None => return false,
    };
    at > 0 && at < s.len() - 1
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .to_string();
    Ok(hash)
}

fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed = match PasswordHash::new(password_hash) {
        Ok(v) => v,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

#[allow(clippy::result_large_err)]
fn access_user_id(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<Uuid, axum::response::Response> {
    let token = match bearer_token(headers) {
        Some(t) => t,
        None => return Err(err(StatusCode::UNAUTHORIZED, "missing_token").into_response()),
    };
    let claims = match decode_access_token(state, &token) {
        Ok(c) => c,
        Err(code) => return Err(err(code, "invalid_token").into_response()),
    };
    let user_id = match Uuid::parse_str(&claims.sub) {
        Ok(v) => v,
        Err(_) => return Err(err(StatusCode::UNAUTHORIZED, "invalid_token").into_response()),
    };
    Ok(user_id)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StaffRole {
    Admin,
    Moderator,
}

async fn require_staff(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> Result<StaffRole, axum::response::Response> {
    let user_id = match access_user_id(state, headers) {
        Ok(v) => v,
        Err(r) => return Err(r),
    };

    let row = sqlx::query("SELECT is_admin, is_moderator, admin_lock_ip FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await;

    let (is_admin, is_moderator, admin_lock_ip): (bool, bool, Option<String>) = match row {
        Ok(Some(r)) => (
            r.get("is_admin"),
            r.try_get("is_moderator").unwrap_or(false),
            r.try_get("admin_lock_ip").ok().flatten(),
        ),
        Ok(None) => return Err(err(StatusCode::UNAUTHORIZED, "invalid_token").into_response()),
        Err(_) => return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response()),
    };

    let role = if is_admin {
        StaffRole::Admin
    } else if is_moderator {
        StaffRole::Moderator
    } else {
        return Err(err(StatusCode::FORBIDDEN, "forbidden").into_response());
    };

    if role == StaffRole::Admin {
        if let Some(locked) = admin_lock_ip
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
        {
            let ip = get_client_ip(headers, connect_info);
            let ip = match ip {
                Some(v) => v,
                None => return Err(err(StatusCode::FORBIDDEN, "admin_ip_required").into_response()),
            };
            if ip != locked {
                return Err(err(StatusCode::FORBIDDEN, "admin_ip_locked").into_response());
            }
        } else {
            let ip = get_client_ip(headers, connect_info);
            if let Some(ip) = ip {
                let now = OffsetDateTime::now_utc();
                let _ = sqlx::query("UPDATE users SET admin_lock_ip = $1, admin_lock_at = $2 WHERE id = $3 AND admin_lock_ip IS NULL")
                    .bind(&ip)
                    .bind(now)
                    .bind(user_id)
                    .execute(&state.pool)
                    .await;
            }
        }
    }
    Ok(role)
}

async fn issue_tokens(
    state: &AppState,
    user_id: Uuid,
    email: &str,
    client_ip: Option<String>,
    user_agent: Option<String>,
    is_admin: bool,
    is_moderator: bool,
    is_founder: bool,
    discount_percent: Option<i32>,
    discount_label: Option<String>,
    discount_expires_at: Option<sqlx::types::time::OffsetDateTime>,
) -> anyhow::Result<AuthResponse> {
    let now = OffsetDateTime::now_utc();
    let access_token = issue_access_token(state, user_id, email)?;

    let refresh = random_token_urlsafe(48);
    let refresh_hash = sha256_hex(refresh.as_bytes());
    let expires_at = now + Duration::days(state.cfg.refresh_token_ttl_days);

    let session_id = Uuid::new_v4();
    sqlx::query(
        r#"
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, client_ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    "#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(refresh_hash)
    .bind(expires_at)
    .bind(client_ip)
    .bind(user_agent)
    .execute(&state.pool)
    .await?;

    Ok(AuthResponse {
        access_token,
        refresh_token: refresh,
        user: UserInfo {
            id: user_id.to_string(),
            email: email.to_string(),
            created_at: None,
            display_name: None,
            avatar_data_url: None,
            is_admin,
            is_moderator,
            is_founder,
            discount_percent,
            discount_label,
            discount_expires_at: discount_expires_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            password_changed_at: None,
        },
    })
}

fn issue_access_token(state: &AppState, user_id: Uuid, email: &str) -> anyhow::Result<String> {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let exp = now + state.cfg.access_token_ttl_seconds;
    let claims = AccessClaims {
        sub: user_id.to_string(),
        email: email.to_string(),
        iat: now as usize,
        exp: exp as usize,
    };
    let token = jsonwebtoken::encode(&Header::default(), &claims, &state.jwt.enc)?;
    Ok(token)
}

fn decode_access_token(state: &AppState, token: &str) -> Result<AccessClaims, StatusCode> {
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let data = jsonwebtoken::decode::<AccessClaims>(token, &state.jwt.dec, &validation)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(data.claims)
}

fn bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let v = headers.get(axum::http::header::AUTHORIZATION)?;
    let s = v.to_str().ok()?;
    let s = s.trim();
    if !s.to_ascii_lowercase().starts_with("bearer ") {
        return None;
    }
    Some(s[7..].trim().to_string())
}

fn random_token_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64_url(&buf)
}

fn base64_url(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() {
            data[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < data.len() {
            data[i + 2] as u32
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if i + 1 < data.len() {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        }
        if i + 2 < data.len() {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        }
        i += 3;
    }
    out
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    hex::encode(digest)
}

fn load_config() -> anyhow::Result<AppConfig> {
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL")?;
    let jwt_secret = std::env::var("JWT_SECRET").context("JWT_SECRET")?;
    let access_token_ttl_seconds = std::env::var("ACCESS_TOKEN_TTL_SECONDS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(15 * 60);
    let refresh_token_ttl_days = std::env::var("REFRESH_TOKEN_TTL_DAYS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(30);
    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let bind_addr = bind.parse::<SocketAddr>().context("BIND_ADDR")?;

    Ok(AppConfig {
        database_url,
        jwt_secret,
        access_token_ttl_seconds,
        refresh_token_ttl_days,
        bind_addr,
    })
}

fn get_client_ip(
    headers: &axum::http::HeaderMap,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> Option<String> {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return Some(ip.to_string());
            }
        }
    }
    if let Some(xrip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let ip = xrip.trim();
        if !ip.is_empty() {
            return Some(ip.to_string());
        }
    }
    if let Some(ConnectInfo(addr)) = connect_info {
        return Some(addr.ip().to_string());
    }
    None
}
