# Multi-stage Docker build for the Kivana API server.
#
# Stage 1 (build):
# - Uses the Rust toolchain to compile a static release binary.
# - Performs a dependency-only build first to maximize Docker layer caching.
#
# Stage 2 (runtime):
# - Minimal Debian image with CA certificates.
# - Copies the compiled binary and the static frontend directories served by the API.

FROM rust:1.88-slim-bookworm AS build

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo build --release

COPY . .
RUN mkdir -p downloads
RUN find src migrations -type f -exec touch {} +
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update -y && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/kivana-api /app/kivana-api
COPY --from=build /app/kivana-admin /app/kivana-admin
COPY --from=build /app/kivana-portal /app/kivana-portal
COPY --from=build /app/kivana-account /app/kivana-account
COPY --from=build /app/kivana-site /app/kivana-site
COPY --from=build /app/downloads /app/downloads
ENV RUST_LOG=info
EXPOSE 8080
CMD ["/app/kivana-api"]
