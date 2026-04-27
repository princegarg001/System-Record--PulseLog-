<div align="center">

# 🏛️ Architecture Decision Records (ADRs)

### **NevUp AI Trading Coach — System of Record**

*Documenting the critical technical decisions, trade-offs, and design principles that ensure the system scales, remains secure, and operates within the p95 ≤ 150ms SLA.*

</div>

---

## 📑 Table of Contents

1. [ADR-001: Event Pipeline Architecture](#adr-001-kafka-over-redis-streams-for-event-pipeline)
2. [ADR-002: Multi-Tenant Data Isolation](#adr-002-postgresql-rls-over-application-level-filters)
3. [ADR-003: Primary Key Strategy](#adr-003-uuid-v4-for-all-primary-keys)
4. [ADR-004: Database Client Selection](#adr-004-node-postgres-pg-over-orm-prismatypeorm)
5. [ADR-005: High-Frequency Metric Aggregation](#adr-005-redis-sorted-set-for-overtrading-detection)
6. [ADR-006: HTTP Framework Selection](#adr-006-fastify-over-express)
7. [ADR-007: Test Runner Architecture](#adr-007-vitest-over-jest-for-testing)
8. [ADR-008: Dynamic Schema Storage](#adr-008-jsonb-for-emotion-statistics)
9. [ADR-009: Asynchronous Publish Semantics](#adr-009-fire-and-forget-kafka-publishing-on-write-path)
10. [ADR-010: Write-Path Idempotency](#adr-010-idempotent-trade-ingestion-via-insert-on-conflict)

---

## ADR-001: Kafka over Redis Streams for Event Pipeline

* **Status**: 🟢 **Accepted**
* **Date**: 2026-04-27

> **Context**: We need a message queue for fire-and-forget trade event publishing from the API server to the analytics worker. The pipeline must handle high throughput without blocking trade ingestion.

**Decision**: Use Apache Kafka (KRaft mode, no ZooKeeper) as the primary message queue.

**Rationale**:
- **Durability**: Kafka persists messages to disk by default, ensuring zero data loss even if the consumer crashes.
- **Exactly-once semantics**: Kafka transactions guarantee exactly-once processing, which is critical for accurate financial metric computation.
- **Partition replay**: Failed messages can be re-consumed by resetting consumer offsets, enabling reprocessing without manual database scans.
- **Throughput**: Scales to millions of messages per second (vs ~100K/sec for Redis Streams).
- **Consumer groups**: Built-in consumer group management allows for seamless horizontal scaling of the analytics workers.

**Consequences**: Adds operational complexity to the infrastructure stack. Mitigated by utilizing KRaft mode (removing the ZooKeeper dependency) and creating a single-command Docker Compose startup.

---

## ADR-002: PostgreSQL RLS over Application-Level Filters

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: Multi-tenant data isolation is the highest security priority. We must prevent cross-tenant data leakage under all circumstances, even if a developer introduces a query bug in the application layer.

**Decision**: Use PostgreSQL Row-Level Security (RLS) policies on all user-scoped tables, serving as a hard security boundary in addition to application-level middleware checks.

**Rationale**:
- **Defense-in-depth**: Even if a `WHERE user_id = ?` clause is accidentally omitted from a raw SQL query, RLS ensures the database engine itself rejects cross-tenant data access.
- **Database-enforced**: The security boundary exists at the lowest possible layer; no application logic bug can bypass it.
- **Zero dependencies**: Utilizes standard, built-in features of Postgres 15 without requiring third-party security plugins.

**Implementation detail**: 
```sql
-- The true flag makes it transaction-local, preventing state leakage across pooled connections
SELECT set_config('app.current_user_id', $1, true);
```

---

## ADR-003: UUID v4 for All Primary Keys

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: We need globally unique identifiers for trades, sessions, and users that are safe for distributed generation, don't leak business metrics, and support idempotent client submissions.

**Decision**: Use UUID v4 for all primary keys. Specifically, `tradeId` must be generated and supplied by the client.

**Rationale**:
- **Prevents ID enumeration**: Sequential IDs allow malicious actors to guess valid IDs and scrape data. UUIDs are cryptographically random.
- **No sequence lock contention**: UUID generation is mathematically lock-free, unlike `SERIAL` or `BIGSERIAL` sequences which can bottleneck under high concurrency.
- **Distributed-safe**: Multiple API server instances (or mobile clients offline) can generate IDs without coordination.
- **Client-supplied trade IDs**: By having the client generate the UUID, we enable safe, idempotent POST retries without requiring server round-trips for idempotency keys.

---

## ADR-004: node-postgres (pg) over ORM (Prisma/TypeORM)

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: We need a database client that provides maximum performance on the hot path, supports explicit SQL tuning, and handles RLS `set_config` transactions safely.

**Decision**: Use raw `node-postgres` (`pg`) with explicit parameterized SQL queries instead of a heavy ORM.

**Rationale**:
- **No hidden N+1 queries**: Every database interaction is explicit, making performance bottlenecks obvious during code review.
- **Prepared statements**: Utilizing `pg.prepare()` for the high-frequency trades `INSERT` path significantly reduces PostgreSQL parse and plan overhead.
- **RLS lifecycle safety**: `set_config('app.current_user_id', ...)` must be called explicitly per transaction. Heavy ORMs often abstract away connection and transaction lifecycles, leading to dangerous context leakage.
- **Full SQL control**: Complex analytics requirements (e.g., `LAG()` window functions for the tilt index, `jsonb_set` atomic operations) require explicit SQL that ORMs struggle to generate efficiently.

---

## ADR-005: Redis Sorted Set for Overtrading Detection

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: Metric M5 (Overtrading Detector) requires maintaining a sliding window counter of trades per user over a rolling 30-minute period. This check occurs on every trade and must not degrade database performance.

**Decision**: Use Redis sorted sets (`ZADD` / `ZCARD` / `ZREMRANGEBYSCORE`) to implement an O(log N) sliding window.

**Rationale**:
- **O(log N) complexity**: Redis sorted sets insert and rank by timestamp in logarithmic time, vastly outperforming an O(N) database `COUNT` query with a `WHERE timestamp > NOW() - 30m`.
- **Atomic execution**: The sequence of adding a trade, removing old trades, and counting the remainder is executed atomically at the Redis level.
- **Zero database load**: This design keeps the high-frequency overtrading check entirely off the PostgreSQL hot path.
- **TTL garbage collection**: Setting `EXPIRE key 3600` automatically cleans up memory for inactive users.

---

## ADR-006: Fastify over Express

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: The API server must ingest trades at a minimum of 200 RPS while maintaining a p95 latency of strictly under 150ms.

**Decision**: Use Fastify 4.x as the core HTTP framework instead of Express.

**Rationale**:
- **2× throughput**: Fastify consistently benchmarks at ~77,000 req/sec compared to Express's ~38,000 req/sec in standard Node.js environments.
- **Built-in JSON Schema**: Utilizes Ajv validation at the framework level, compiling schemas to highly optimized JavaScript functions on startup rather than using slow, reflection-based middleware.
- **Structured serialization**: Employs `fast-json-stringify` to serialize responses faster than native `JSON.stringify()`.
- **TypeScript-first**: Provides strict, predictable type definitions out of the box, aligning with our zero-`any` policy.

---

## ADR-007: Vitest over Jest for Testing

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: We require a test runner that executes hundreds of unit and integration tests quickly, with native support for our TypeScript source files.

**Decision**: Use Vitest 2.x for all test suites.

**Rationale**:
- **3× faster for TypeScript**: Vitest offers native ESM (ECMAScript Module) support without requiring a slow compilation step like `ts-jest`.
- **Vite-powered**: Extremely fast Hot Module Replacement (HMR) for watch mode during local development.
- **Jest-compatible API**: Serves as a drop-in replacement, allowing us to use familiar `describe`/`it`/`expect` patterns without learning a new assertion library.
- **Zero-config TypeScript**: Completely eliminates the need for complex `tsconfig` mapping or `@types/jest` packages.

---

## ADR-008: JSONB for Emotion Statistics

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: Metric M4 (Win Rate by Emotion) requires tracking win/loss counters for specific emotional states. The list of valid emotions may expand as the product evolves.

**Decision**: Store `wins_by_emotion` and `losses_by_emotion` as `JSONB` columns in the `user_metrics` table.

**Rationale**:
- **Schema flexibility**: Adding a new emotion (e.g., "frustrated") requires absolutely no DDL schema migration.
- **Atomic updates**: Leveraging PostgreSQL's `jsonb_set()` function allows us to atomically increment nested counters without dangerous read-modify-write race conditions.
- **Single-row storage**: All emotion statistics for a user are kept in a single row, eliminating the need for expensive `JOIN` operations on the metrics read path.
- **Query-friendly**: `JSONB` supports indexed access (using the `->` operator) for fast retrieval of individual emotion data.

---

## ADR-009: Fire-and-Forget Kafka Publishing on Write Path

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: The trade ingestion SLA is strictly p95 < 150ms. Publishing events to Kafka takes network time. This latency must not impact the client's HTTP response time.

**Decision**: Kafka `producer.send()` is executed *without* `await` on the API write path. Errors are caught asynchronously and logged to standard out.

**Rationale**:
- **Write-path isolation**: Analytics and event propagation must *never* block the ingestion of the System of Record (Inviolable Principle #1).
- **SLA budget protection**: The total write path budget is ~66ms. Awaiting a Kafka broker acknowledgment would risk breaching the 150ms p95 SLA during network spikes.
- **Acceptable trade-off**: If Kafka is temporarily unavailable, the trade is still durably persisted in PostgreSQL. The analytics worker can be triggered to reprocess missing events from a database scan if necessary.
- **Error visibility**: Publish failures are caught asynchronously and logged with the request's `traceId` for exact correlation debugging.

---

## ADR-010: Idempotent Trade Ingestion via INSERT ON CONFLICT

* **Status**: 🟢 **Accepted**  
* **Date**: 2026-04-27

> **Context**: Mobile clients may retry trade submissions due to spotty network connections. Duplicate submissions must be handled gracefully without throwing server errors.

**Decision**: Utilize PostgreSQL's `INSERT ... ON CONFLICT (trade_id) DO NOTHING` for all trade ingestion.

**Rationale**:
- **Strictly 200 OK**: The project specification requires that duplicate submissions return a `200 OK` (existing), not a `409 Conflict` or `500 Server Error`.
- **Single-query check**: Avoids the classic race condition of a separate `SELECT` followed by an `INSERT`. The database engine handles the uniqueness check atomically.
- **Client-supplied idempotency**: The idempotency key is the `trade_id` UUID generated by the client, ensuring the exact same payload is recognized as a duplicate.
- **Deterministic behavior**: The same input always produces the exact same final state in the database, regardless of how many times the client retries the request.
