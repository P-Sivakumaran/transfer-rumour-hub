# Data retention

## ProductEvent (product analytics)

`ProductEvent` (`docs/monetisation-proposal.md`'s privacy-conscious
instrumentation — watchlist creation, alert activation, provenance-panel
views, forecast-history views, upgrade-interest clicks) is purged daily.

- **Retention window**: `PRODUCT_EVENT_RETENTION_DAYS`, default **90**.
  Read live at purge time (`analytics/retention.ts`'s `retentionDays()`),
  so changing the env var takes effect on the next scheduled run — no
  restart-and-migrate step.
- **Schedule**: daily, via BullMQ (`queue/scheduler.ts`'s
  `purge-product-events-recurring` job scheduler, alongside the RSS
  ingest and player-sync schedulers this app already runs). Also fires
  once on server boot (harmless — the operation is idempotent, see
  below).
- **Mechanism**: `analytics/retention.ts`'s `runRetentionPurge()` — calls
  `purgeOldProductEvents()` (a plain `DELETE ... WHERE createdAt < cutoff`),
  then records the outcome to a single-row `PurgeHealth` table (not an
  append-only log — see "Why a single row, not a log" below).
- **Idempotent**: re-running against already-purged data deletes zero
  rows and reports success — it's just a delete-by-timestamp, there's no
  state that "has already run" needs to track. Verified in
  `analytics/retention.test.ts`.
- **Failure handling**: a failed purge is caught, recorded to
  `PurgeHealth` (`lastRunSucceeded: false`, `lastError`), logged as an
  `OperationalEvent` (`RETENTION_PURGE_FAILURE`), and re-thrown so the
  BullMQ job itself is marked failed (retried per the `maintenance`
  queue's own attempts/backoff config, visible in BullMQ's own failed-job
  listing on top of the two records above).

## Checking whether the purge is healthy

`GET /admin/purge-health` (admin-only, `docs/admin-operations.md`):

```json
{
  "lastRunStartedAt": "2026-08-14T03:00:00.000Z",
  "lastRunCompletedAt": "2026-08-14T03:00:00.180Z",
  "lastRunSucceeded": true,
  "lastDeletedCount": 142,
  "lastCutoff": "2026-05-16T03:00:00.000Z",
  "lastError": null,
  "updatedAt": "2026-08-14T03:00:00.180Z"
}
```

A `null` response (before the job has ever run) means exactly that — no
purge has executed yet, not an error.

## Runbook: the purge job has failed

1. Check `GET /admin/purge-health` — `lastError` has the exception
   message from the failed attempt.
2. Check the `maintenance` BullMQ queue's failed-job list (same Redis
   instance as the other queues — `queue/connection.ts`) for the stack
   trace and retry count.
3. Most likely cause: a database connectivity issue at run time — the
   next scheduled run (within 24h) will retry automatically; no manual
   re-trigger endpoint exists in this implementation. To force an
   immediate retry, add a job to the `maintenance` queue directly (e.g.
   via a one-off script calling `maintenanceQueue.add('purge-product-events-manual',
   { task: 'purge-product-events' })`) — there is no HTTP endpoint for
   this, by design (it's an operational action, not a product one).
4. If failures persist, check whether `PRODUCT_EVENT_RETENTION_DAYS` is
   set to something pathological (e.g. `0` or negative) — the parser
   falls back to the 90-day default in that case rather than erroring, so
   this specific failure mode shouldn't occur, but is worth ruling out
   first if the cutoff timestamp in `purge-health` looks wrong.

## Why a single row, not a log

An earlier draft of this feature considered an append-only "purge run
history" table. Rejected: that table would itself need a retention policy,
recreating the exact problem this feature exists to solve, just one layer
down. A single upserted row (`id` fixed to `1`) gives "did the last run
succeed, when, how many rows" — everything the task's health-check
requirement asks for — without ever growing.

## Other event tables and their retention posture

- **`OperationalEvent`** (security/ops log — `docs/public-beta-readiness-audit.md`
  §6, entitlement denials, API-key auth outcomes, admin actions, purge
  outcomes): **no retention policy implemented in this task.** This is a
  gap, stated plainly rather than left implicit — an operational log that
  never expires will eventually need the same treatment `ProductEvent`
  just got. Deferred because these events carry no per-user behavioral
  profile (no `userId` field at all — see the model's schema comment) and
  are lower-volume than `ProductEvent`, but "lower priority" is not "not a
  problem."
- **`AdminAuditEvent`** (immutable audit trail): **intentionally never
  purged.** An audit log that can silently lose old entries defeats its
  own purpose — if this table's growth ever becomes an operational
  concern, the fix is archival to cold storage, not deletion.
- **`ApiKeyUsageEvent`**: no retention policy implemented, same gap and
  same reasoning as `OperationalEvent` — flagged, not fixed, in this task.
