use anyhow::Context;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, FromRef, OriginalUri, State};
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
struct SignupRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
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
    display_name: Option<String>,
    avatar_data_url: Option<String>,
    is_admin: bool,
    is_moderator: bool,
    is_founder: bool,
    discount_percent: Option<i32>,
    discount_label: Option<String>,
    discount_expires_at: Option<String>,
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
    features: Vec<String>,
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
        .route("/v1/contact", post(contact))
        .route("/v1/auth/signup", post(signup))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/refresh", post(refresh))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/me", get(me))
        .route("/v1/profile", post(update_profile))
        .route("/v1/entitlements", get(entitlements))
        .route("/v1/admin/bootstrap", post(admin_bootstrap))
        .route("/v1/admin/users", get(admin_users))
        .route("/v1/admin/contact-messages", get(admin_contact_messages))
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
        .route("/v1/admin/moderator", post(admin_set_moderator))
        .route("/v1/admin/discount", post(admin_set_discount))
        .route("/v1/admin/grant", post(admin_grant))
        .route("/v1/portal/select-plan", post(portal_select_plan))
        .route("/v1/events/poll", get(poll_events))
        .route("/admin", get(|| async { Redirect::permanent("/admin/") }))
        .nest_service(
            "/admin/",
            ServeDir::new("kivana-admin").append_index_html_on_directories(true),
        )
        .route("/portal", get(portal_redirect))
        .nest_service(
            "/portal/",
            ServeDir::new("kivana-portal").append_index_html_on_directories(true),
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

async fn portal_redirect(uri: OriginalUri) -> impl IntoResponse {
    let q = uri.0.query().map(|v| format!("?{}", v)).unwrap_or_default();
    let target = format!("/portal/{}", q);
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
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
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

    let user_id = Uuid::new_v4();
    let password_hash = match hash_password(&req.password) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed").into_response(),
    };

    let tx = state.pool.begin().await;
    let mut tx = match tx {
        Ok(v) => v,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let inserted = sqlx::query(
        r#"
      INSERT INTO users (id, email, password_hash, last_ip)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    "#,
    )
    .bind(user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&client_ip)
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
        let now = OffsetDateTime::now_utc();
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

    let tokens = issue_tokens(
        &state,
        user_id,
        &email,
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

    if let Some(ip) = client_ip {
        let _ = sqlx::query("UPDATE users SET last_ip = $1 WHERE id = $2")
            .bind(ip)
            .bind(user_id)
            .execute(&state.pool)
            .await;
    }

    let tokens = issue_tokens(
        &state,
        user_id,
        &email,
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

    let updated = sqlx::query(
        r#"
      UPDATE sessions
      SET refresh_token_hash = $1, last_used_at = $2, expires_at = $3
      WHERE id = $4
    "#,
    )
    .bind(&new_hash)
    .bind(now)
    .bind(expires_at)
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
        "SELECT id, email, display_name, avatar_data_url, is_admin, is_moderator, is_founder, discount_percent, discount_label, discount_expires_at FROM users WHERE id = $1",
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
    let display_name: Option<String> = row.try_get("display_name").unwrap_or(None);
    let avatar_data_url: Option<String> = row.try_get("avatar_data_url").unwrap_or(None);
    let is_admin: bool = row.try_get("is_admin").unwrap_or(false);
    let is_moderator: bool = row.try_get("is_moderator").unwrap_or(false);
    let is_founder: bool = row.try_get("is_founder").unwrap_or(false);
    let discount_percent: Option<i32> = row.try_get("discount_percent").ok().flatten();
    let discount_label: Option<String> = row.try_get("discount_label").ok().flatten();
    let discount_expires_at: Option<sqlx::types::time::OffsetDateTime> =
        row.try_get("discount_expires_at").ok().flatten();
    (
        StatusCode::OK,
        Json(UserInfo {
            id: id.to_string(),
            email,
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

    let rows = sqlx::query(
        r#"
      SELECT
        p.code AS product_code,
        pl.code AS plan_code,
        pl.name AS plan_name,
        s.status AS status,
        s.ends_at AS ends_at
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

        products.push(ProductEntitlement {
            product_code,
            plan_code,
            plan_name,
            status,
            ends_at: ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            features,
        });
    }

    (StatusCode::OK, Json(EntitlementsResponse { products })).into_response()
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

    let valid_plans = ["basic", "standard", "pro", "lifetime_pro"];
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

    let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = $2")
        .bind(product_id)
        .bind(&plan_code)
        .fetch_optional(&state.pool)
        .await;
    let plan_id: Uuid = match plan_row {
        Ok(Some(r)) => r.get("id"),
        _ => return err(StatusCode::NOT_FOUND, "plan_not_found").into_response(),
    };

    if plan_code == "basic" {
        let existing = sqlx::query(
            "SELECT 1 FROM subscriptions WHERE user_id = $1 AND product_id = $2 LIMIT 1",
        )
        .bind(user_id)
        .bind(product_id)
        .fetch_optional(&state.pool)
        .await;

        match existing {
            Ok(Some(_)) => return err(StatusCode::FORBIDDEN, "trial_already_used").into_response(),
            Ok(None) => {}
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
        }
    }

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

    let (ends_at, trial_ends_at) = match plan_code.as_str() {
        "basic" => {
            let trial_end = now + Duration::days(14);
            (Some(trial_end), Some(trial_end))
        }
        "standard" | "pro" => {
            let days = if billing_cycle == "yearly" { 365 } else { 30 };
            (Some(now + Duration::days(days)), None)
        }
        "lifetime_pro" => (None, None),
        _ => (None, None),
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

    (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
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

    let prod_row = sqlx::query("SELECT id FROM products WHERE code = $1")
        .bind(&product_code)
        .fetch_optional(&state.pool)
        .await;
    let product_id: Uuid = match prod_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return err(StatusCode::NOT_FOUND, "product_not_found").into_response(),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "db_error").into_response(),
    };

    let plan_row = sqlx::query("SELECT id FROM plans WHERE product_id = $1 AND code = $2")
        .bind(product_id)
        .bind(&plan_code)
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

    let sub_id = Uuid::new_v4();
    let inserted = sqlx::query(
    "INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, ends_at) VALUES ($1,$2,$3,$4,'active',$5,$6)",
  )
  .bind(sub_id)
  .bind(user_id)
  .bind(product_id)
  .bind(plan_id)
  .bind(now)
  .bind(ends_at)
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
        u.is_admin AS is_admin,
        u.is_moderator AS is_moderator,
        u.is_founder AS is_founder,
        u.discount_percent AS discount_percent,
        u.discount_label AS discount_label,
        u.discount_expires_at AS discount_expires_at,
        u.last_ip AS last_ip,
        pl.code AS plan_code,
        pl.name AS plan_name,
        s.ends_at AS ends_at
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

    let updated = sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(password_hash)
        .bind(id)
        .execute(&state.pool)
        .await;

    match updated {
        Ok(r) if r.rows_affected() > 0 => {
            let now = OffsetDateTime::now_utc();
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
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    "#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(refresh_hash)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(AuthResponse {
        access_token,
        refresh_token: refresh,
        user: UserInfo {
            id: user_id.to_string(),
            email: email.to_string(),
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
