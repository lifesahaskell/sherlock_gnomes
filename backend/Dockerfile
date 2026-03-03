FROM rust:1-bookworm AS builder

WORKDIR /app
COPY backend ./backend
WORKDIR /app/backend
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/backend/target/release/codebase-explorer-backend /usr/local/bin/codebase-explorer-backend

ENV HOST=0.0.0.0
ENV PORT=8787
ENV EXPLORER_ROOT=/workspace

EXPOSE 8787
CMD ["codebase-explorer-backend"]
