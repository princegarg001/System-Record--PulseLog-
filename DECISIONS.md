# Architecture Decision Records (ADR)

## ADR-001: Kafka over Redis Streams for Event Pipeline

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: We need a message queue for fire-and-forget trade event publishing from the API server to the analytics worker.

**Decision**: Use Apache Kafka (KRaft mode, no ZooKeeper) as the primary message queue.

**Rationale**:
- **Durability**: Kafka persists messages to disk by default, ensuring no data loss even if the consumer is down
- **Exactly-once semantics**: Kafka transactions guarantee exactly-once processing, critical for accurate metric computation
- **Partition replay**: Failed messages can be re-consumed by resetting consumer offsets, enabling reprocessing without data loss
- **Throughput**: Millions of messages per second vs ~100K/sec for Redis Streams
- **Consumer groups**: Built-in consumer group management for horizontal scaling of analytics workers

**Consequences**: Adds operational complexity (Kafka broker). Mitigated by KRaft mode (no ZooKeeper dependency) and Docker Compose single-command startup.

---

## ADR-002: PostgreSQL RLS over Application-Level Filters

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Multi-tenant data isolation must prevent any cross-tenant data leakage, even if the application layer has query bugs.

**Decision**: Use PostgreSQL Row-Level Security (RLS) policies on all user-scoped tables, in addition to application-level tenancy enforcement.

**Rationale**:
- **Defense-in-depth**: Even if a WHERE clause is accidentally omitted, RLS ensures data cannot leak across tenants
- **Database-enforced**: Security boundary at the DB layer means no application bug can bypass it
- **Standard PostgreSQL feature**: No external dependency, built into Postgres 15

**Implementation detail**: `set_config('app.current_user_id', userId, true)` — the `true` flag makes it transaction-local, preventing state leakage across pooled connections.

---

## ADR-003: UUID v4 for All Primary Keys

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Need globally unique identifiers that are safe for distributed generation and don't leak information.

**Decision**: Use UUID v4 for all primary keys. Trade IDs are client-supplied (idempotency keys).

**Rationale**:
- **Prevents ID enumeration**: Sequential IDs allow attackers to guess valid IDs
- **No sequence lock contention**: UUID generation is lock-free, unlike SERIAL/BIGSERIAL
- **Distributed-safe**: Multiple API server instances can generate IDs without coordination
- **Client-supplied trade IDs**: Enable idempotent submissions without server round-trips

---

## ADR-004: node-postgres (pg) over ORM (Prisma/TypeORM)

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Need a database client that supports explicit SQL, prepared statements, and RLS set_config.

**Decision**: Use raw `node-postgres` (pg) with explicit SQL queries.

**Rationale**:
- **No hidden N+1 queries**: Every query is explicit and visible in code review
- **Prepared statements**: `pg.prepare()` for the hot trades INSERT path reduces parse overhead
- **RLS compatibility**: `set_config('app.current_user_id', ...)` must be called explicitly per connection — ORMs abstract away connection lifecycle
- **Full SQL control**: Window functions (LAG for tilt index), JSONB operations, and GENERATED ALWAYS AS columns require explicit SQL

---

## ADR-005: Redis Sorted Set for Overtrading Detection

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: M5 (Overtrading Detector) needs a sliding window counter for trades per user. Must not block the write path.

**Decision**: Use Redis sorted sets (ZADD/ZCARD/ZREMRANGEBYSCORE) for O(log N) sliding window counting.

**Rationale**:
- **O(log N) complexity**: vs O(N) for a DB COUNT query with WHERE on timestamp range
- **Atomic operations**: ZADD + ZREMRANGEBYSCORE + ZCARD is atomic at the Redis level
- **No DB load**: Keeps the overtrading check off the PostgreSQL hot path entirely
- **TTL-based cleanup**: `EXPIRE key 3600` automatically garbage-collects old windows
- **Non-blocking**: Runs in the analytics worker, never on the API write path

---

## ADR-006: Fastify over Express

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Need an HTTP framework that can handle 200 RPS with p95 < 150ms.

**Decision**: Use Fastify 4.x instead of Express.

**Rationale**:
- **2× throughput**: Fastify benchmarks at ~77,000 req/sec vs ~38,000 for Express
- **Built-in Ajv validation**: JSON Schema validation at the framework level, no external middleware
- **Structured serialization**: Fast JSON serialization with `fast-json-stringify`
- **Plugin architecture**: Clean encapsulation for route modules
- **TypeScript-first**: Strong type definitions out of the box

---

## ADR-007: Vitest over Jest for Testing

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Need a fast TypeScript-native test runner.

**Decision**: Use Vitest 2.x for all unit and integration tests.

**Rationale**:
- **3× faster for TypeScript**: Native ESM support without compilation step
- **Vite-powered**: HMR for watch mode during development
- **Jest-compatible API**: Drop-in replacement, same `describe`/`it`/`expect` patterns
- **Native TypeScript**: No `ts-jest` or `@types/jest` needed
- **Supertest integration**: Works seamlessly with Fastify's `.inject()` for HTTP tests

---

## ADR-008: JSONB for Emotion Statistics

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: M4 (Win Rate by Emotion) needs per-emotion win/loss counters. The emotion enum may expand.

**Decision**: Store `wins_by_emotion` and `losses_by_emotion` as JSONB columns in `user_metrics`.

**Rationale**:
- **Schema flexibility**: Adding a new emotion value (e.g., "frustrated") requires no schema migration
- **Atomic updates**: PostgreSQL `jsonb_set()` enables atomic increment without read-modify-write race conditions
- **Single-row storage**: All emotion stats for a user in one row, no join needed for the metrics read path
- **Query-friendly**: JSONB supports indexed access (`->` operator) for individual emotion lookups

**Format**: `{"calm": 18, "anxious": 4, "greedy": 3, "fearful": 2, "neutral": 10}`

---

## ADR-009: Fire-and-Forget Kafka Publishing on Write Path

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Trade ingestion SLA is p95 < 150ms. Kafka publish latency must not be added to the critical path.

**Decision**: Kafka `producer.send()` is called without `await` on the write path. Errors are caught asynchronously and logged.

**Rationale**:
- **Write-path isolation**: Analytics never block trade ingestion (inviolable principle #1)
- **SLA budget**: Total write path budget is ~66ms. Adding Kafka await would risk exceeding 150ms p95
- **Acceptable trade-off**: If Kafka is temporarily unavailable, the trade is still persisted in PostgreSQL. The analytics worker can reprocess from a full table scan if needed
- **Error visibility**: Publish failures are logged with traceId for debugging, never silently swallowed

---

## ADR-010: Idempotent Trade Ingestion via INSERT ON CONFLICT

**Status**: Accepted  
**Date**: 2026-04-27

**Context**: Client may retry trade submissions due to network issues. Duplicates must not cause errors.

**Decision**: Use `INSERT ... ON CONFLICT (trade_id) DO NOTHING` for trade ingestion.

**Rationale**:
- **No 409 errors**: Spec requires duplicate submissions return 200, not 409 or 500
- **Single-query check**: No separate SELECT-then-INSERT; atomically handles the idempotency check
- **Client-supplied trade_id**: The idempotency key is the trade's UUID, supplied by the client
- **Deterministic behavior**: Same input always produces the same output regardless of retry count
