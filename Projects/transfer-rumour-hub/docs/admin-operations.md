# Admin operations

Covers role-based admin access, added this session to replace the
shared-secret `ADMIN_TOKEN` check. See
`docs/public-beta-readiness-audit.md` for the design rationale.

## Getting the first admin — bootstrap ordering

There is no self-service "become admin" flow, by design (a non-admin must
never be able to elevate their own tier — enforced structurally: only
`requireAdmin`-gated routes can grant a tier, and only an admin can pass
`requireAdmin`). The very first admin is created via an environment
variable, read once at server startup:

```
BOOTSTRAP_ADMIN_EMAIL=you@example.com
```

**Ordering matters — this is not a one-shot flow:**

1. Register the account normally (`POST /auth/register`), or it must
   already exist.
2. Set `BOOTSTRAP_ADMIN_EMAIL` in the environment.
3. Restart the server. `admin/bootstrap.ts` runs once at boot: if a `User`
   with that email exists, it's promoted to `ADMIN` (idempotent — safe to
   leave the variable set across future restarts, it's a no-op once the
   user is already an admin). If no such user exists yet, it logs a
   warning and does nothing — it does **not** retry or wait.
4. Log in. The session cookie now carries an account with `role: ADMIN`.

Every subsequent admin is granted the normal way: an existing admin sets
their role — there's currently no HTTP endpoint for role changes (only for
tier changes, see below); promoting a second admin today means running the
same `BOOTSTRAP_ADMIN_EMAIL` bootstrap again for their email, or a direct
database write. A `PATCH /admin/users/:id/role` endpoint is a reasonable
small follow-up, not built here — out of this task's scope.

## Granting a paid tier

`POST /admin/users/:id/entitlement` — the only way a user's `tier`
(FREE/PRO/RESEARCH) changes in this implementation, since no payment
provider exists (`docs/monetisation-proposal.md`).

```
curl -X POST http://localhost:3001/admin/users/42/entitlement \
  -H 'Content-Type: application/json' \
  --cookie "token=<admin session JWT>" \
  -d '{"tier":"PRO"}'
```

Requires:
- An authenticated session (`token` cookie) belonging to a `User` with
  `role: ADMIN` — `401` if no session, `403` if authenticated but not
  admin.
- A valid tier value (`FREE`, `PRO`, or `RESEARCH`) — `400` otherwise.
- The target user to exist — `404` otherwise.

Rate-limited to 20 requests per 60 seconds per acting admin
(`lib/rateLimit.ts`, Redis-backed, fails **closed** — see below). Every
successful grant writes an immutable `AdminAuditEvent` row (acting admin,
target user, previous tier, new tier, entitlement source, timestamp,
correlation ID) — there is no update or delete path for that table
anywhere in the codebase.

## Revoking a Research API key

`POST /admin/api-keys/:id/revoke` — admin-only (an owner can view but not
revoke their own keys through this app; see `docs/research-api.md`).
`204` on success, `404` if the key doesn't exist. `403` for a non-admin.

## Checking retention-purge health

`GET /admin/purge-health` — the single-row status of the last daily
`ProductEvent` purge run (`docs/data-retention.md`): start/completion
time, rows deleted, cutoff used, success/failure, and the error message if
it failed. Useful as a manual or scripted health check; there is no
alerting wired to it in this implementation.

## What's still unauthenticated

Every other route under `/admin/*` (`/admin/rumours/:id/outcome`,
`/admin/sources`, `/admin/players/:id/enrich`, `/admin/players/sync`,
`/admin/rumours`) has **no authentication at all** — a pre-existing gap in
this codebase, not introduced or fixed by this task (explicitly out of
scope: "do not touch unrelated backend files"). `requireAdmin` now exists
and is a drop-in fit for those routes; closing this gap is a small,
well-scoped follow-up, not a redesign.

## Rate limiting and its failure mode

The admin-grant rate limiter fails **closed**: if Redis is unreachable,
requests are rejected rather than let through unlimited. This is the
opposite choice from the Research API-key rate limiter (`docs/research-api.md`),
which fails open — the reasoning is in
`docs/public-beta-readiness-audit.md` §5: this route is low-traffic and
high-consequence (it grants purchasing power with no purchase), so failing
closed is the safer default here specifically.

## Known limitations

- No role-change HTTP endpoint (`role` can only be set via
  `BOOTSTRAP_ADMIN_EMAIL` or a direct database write).
- No UI for any of this — every operation above is a raw HTTP call.
- The nine unauthenticated `/admin/*` routes listed above.
