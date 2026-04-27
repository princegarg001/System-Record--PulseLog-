<p align="center">
  <h1 align="center">🧠 NevUp — AI Trading Coach Backend</h1>
  <p align="center">
    <strong>Track 1: System of Record · NevUp Hiring Hackathon 2026</strong>
  </p>
  <p align="center">
    Production-grade backend powering behavioral analytics for retail traders.<br/>
    Idempotent trade ingestion · Event-driven metrics pipeline · Multi-tenant RLS security
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/node-%3E%3D20-green?logo=node.js" alt="Node 20+"/>
    <img src="https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript" alt="TypeScript Strict"/>
    <img src="https://img.shields.io/badge/Fastify-4.x-black?logo=fastify" alt="Fastify"/>
    <img src="https://img.shields.io/badge/PostgreSQL-15_+_RLS-336791?logo=postgresql" alt="PostgreSQL 15"/>
    <img src="https://img.shields.io/badge/Kafka-KRaft-231F20?logo=apachekafka" alt="Kafka"/>
    <img src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis" alt="Redis"/>
    <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker" alt="Docker"/>
    <img src="https://img.shields.io/badge/tests-42_passing-brightgreen" alt="42 Tests"/>
    <img src="https://img.shields.io/badge/SLA-p95_%E2%89%A4_150ms-orange" alt="p95 SLA"/>
  </p>
</p>

---

## 🎯 What This Is

A **production-grade System of Record backend** for an AI-powered trading psychology coach. Instead of just tracking P&L, this system detects **behavioral pathologies** in real-time — revenge trading, overtrading, emotional tilt — and surfaces coaching insights through an asynchronous metrics pipeline.

### Three Inviolable Principles

| # | Principle | Enforcement |
|---|---|---|
| 1 | **Write-path isolation** | Analytics never block trade ingestion. Kafka publish is fire-and-forget. |
| 2 | **Idempotency everywhere** | `INSERT ... ON CONFLICT DO NOTHING`. Duplicates return 200, never 409. |
| 3 | **Tenant-first security** | PostgreSQL RLS + JWT tenancy check. Cross-tenant = 403, never 404. |

---

## 🏗 Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              Fastify API Server              │
  Client ──► JWT Auth ──┤  POST /trades ──► PostgreSQL 15 (RLS)       │
                        │       │                                      │
                        │       └── fire-and-forget ──► Kafka          │
                        │                              (trade.closed)  │
                        └─────────────────────────────────────────────┘
                                                  │
                                                  ▼
                        ┌─────────────────────────────────────────────┐
                        │           Analytics Worker (Consumer)        │
                        │                                              │
                        │  Phase 1 (parallel):                        │
                        │    M1 Plan Adherence · M4 Win/Emotion · M5  │
                        │                                              │
                        │  Phase 2 (sequential):                      │
                        │    M2 Revenge Flag · M3 Session Tilt        │
                        │                                              │
                        │  M5 ──► Redis (sorted set sliding window)   │
                        └─────────────────────────────────────────────┘
```

---

## 📊 Behavioral Metrics Engine (M1–M5)

| Metric | What It Detects | Algorithm | Data Store |
|---|---|---|---|
| **M1** Plan Adherence | Discipline decay | Rolling 10-trade average | `user_metrics` |
| **M2** Revenge Trade | Anger-driven re-entry | 90s gap + anxious/fearful emotion | `trades.revenge_flag` |
| **M3** Session Tilt | Spiral after losses | `LAG()` window function | `session_metrics` |
| **M4** Win by Emotion | Emotional edge | Atomic `jsonb_set()` counters | `user_metrics` JSONB |
| **M5** Overtrading | Frantic activity | Redis `ZADD/ZCARD` 30-min window | Events + Alerts |

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose

### Single Command — Zero Manual Steps
```bash
docker compose up
```

This starts **5 services** (PostgreSQL, Redis, Kafka, API, Worker), runs migrations, and seeds **388 trades** from **10 synthetic traders** — all queryable immediately.

### Local Development
```bash
npm install                  # Install dependencies
npm run migrate              # Run DB migrations
npm run seed                 # Load 388 seed trades
npm run dev                  # API server (hot reload)
npm run worker               # Analytics worker (separate terminal)
npm run generate-token       # Generate JWT tokens for testing
npm test                     # Run 42 unit tests
```

---

## 🔐 Security Model

| Layer | Mechanism | Detail |
|---|---|---|
| **Authentication** | JWT HS256 | `jose` library, 0s clock tolerance, 24h expiry |
| **Authorization** | RLS Policies | `set_config('app.current_user_id', userId, true)` — transaction-local |
| **Tenancy** | Middleware + DB | JWT `sub` ≠ requested `userId` → **403 FORBIDDEN** (never 404) |
| **Idempotency** | `ON CONFLICT` | Duplicate `tradeId` → 200 OK, not 409 Conflict |

---

## 🛣️ API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/trades` | JWT | Idempotent trade ingestion (core write path) |
| `GET` | `/trades/:tradeId` | JWT | Get single trade |
| `GET` | `/users/:userId/metrics` | JWT | Behavioral metrics with timeseries |
| `GET` | `/users/:userId/trades` | JWT | Paginated trade history |
| `GET` | `/users/:userId/profile` | JWT | Behavioral profile |
| `GET` | `/sessions/:sessionId` | JWT | Session summary with trades |
| `POST` | `/sessions/:sessionId/debrief` | JWT | Post-session reflection |
| `GET` | `/sessions/:sessionId/coaching` | JWT | SSE coaching stream |
| `GET` | `/health` | — | DB + Redis + Kafka status |
| `GET` | `/metrics` | — | Prometheus scrape endpoint |

---

## 🧪 Testing

- **42 unit tests** covering validation, auth, tenancy, and all 5 metric algorithms
- **Cross-tenant security tests** proving 403 on cross-tenant reads
- **k6 load test** targeting 200 RPS with p95 ≤ 150ms SLA threshold

---

## 📂 Project Structure

```
nevup-backend/
├── src/
│   ├── api/routes/          # trades, metrics, sessions, health
│   ├── middleware/           # auth, tenancy, requestLogger, errorHandler
│   ├── services/metrics/    # M1–M5 behavioral metric engines
│   ├── services/            # tradeService, metricsService, pipeline
│   ├── workers/             # analyticsWorker, dlqWorker
│   ├── db/                  # pool, rls, migrate, seed
│   ├── cache/               # Redis singleton
│   ├── queue/               # Kafka producer + consumer
│   └── utils/               # logger, validate, tracing
├── migrations/              # 001_schema.sql, 002_seed.sql
├── tests/                   # unit + security tests
├── k6/                      # load test script + results
├── k8s/                     # Kubernetes manifests
├── .github/workflows/       # CI pipeline
├── DECISIONS.md             # 10 Architecture Decision Records
├── openapi.yaml             # OpenAPI 3.0 specification
├── docker-compose.yml       # Single-command startup (5 services)
└── Dockerfile               # Multi-stage, non-root user
```

---

## ⚡ Performance

| Metric | Target | Strategy |
|---|---|---|
| Write latency (p95) | **≤ 150ms** | Fire-and-forget Kafka, connection pooling |
| Throughput | **200 RPS** | Fastify (2× Express), prepared statements |
| Error rate | **< 1%** | Idempotent writes, graceful degradation |

---

## 📋 Seed Data

- **10 synthetic traders** with labeled behavioral pathologies
- **52 sessions**, **388 trades** across equity, crypto, and forex
- Covers: revenge trading, overtrading, FOMO, plan non-adherence, premature exit, loss running, session tilt, time-of-day bias, position sizing inconsistency
- **1 control user** (Avery Chen) with zero pathologies

---

## 🧾 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x (strict) |
| Framework | Fastify 4.x |
| Database | PostgreSQL 15 + RLS |
| Queue | Apache Kafka (KRaft) |
| Cache | Redis 7 |
| Auth | jose (HS256) |
| Logging | Pino (structured JSON) |
| Metrics | prom-client (Prometheus) |
| Testing | Vitest 2.x |
| Load Testing | k6 |
| Containers | Docker + Compose |
| Orchestration | Kubernetes |
| CI/CD | GitHub Actions |

---

## 📖 Architecture Decisions

See [`DECISIONS.md`](DECISIONS.md) for 10 detailed ADR entries covering:
- Kafka over Redis Streams
- PostgreSQL RLS over application filters
- Raw SQL over ORM
- Redis sorted sets for overtrading
- Fire-and-forget publish semantics
- JSONB for emotion statistics
- And more...

---

<p align="center">
  Built for the <strong>NevUp Hiring Hackathon 2026 — Track 1: System of Record</strong>
</p>
