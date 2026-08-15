# Research API

Documents the Research/API tier's programmatic access, added this session
to close the "Research tier has no real API-key auth" gap flagged in
`docs/monetisation-proposal.md` and `docs/public-beta-readiness-audit.md`.
This is a working implementation of the packaging tier's mechanics, not a
production-ready public API — see "Known limitations" below before
pointing external traffic at it.

## Getting a key

Requires an authenticated session (cookie) belonging to a `User` with
`tier: RESEARCH` (granted by an admin — `docs/admin-operations.md`).

```
POST /api-keys
Cookie: token=<your session JWT>
Content-Type: application/json

{ "name": "my analysis script", "scopes": ["RESEARCH_READ"], "expiresAt": "2027-01-01T00:00:00Z" }
```

`expiresAt` is optional (omit for a key that never expires). Response:

```json
{
  "id": 7,
  "name": "my analysis script",
  "scopes": ["RESEARCH_READ"],
  "keyPrefix": "a1b2c3d4e5f6",
  "key": "a1b2c3d4e5f6.9f8e7d6c5b4a...",
  "createdAt": "...",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "warning": "Store this key now — it will not be shown again."
}
```

**The `key` field is shown exactly once, in this response.** Only its
SHA-256 hash is stored (`apiKeys/hashing.ts`) — there is no "forgot my
key" recovery, only revoke-and-recreate.

## Scopes

- `RESEARCH_READ` — required by `GET /research/historical-claims`.
- `RESEARCH_EXPORT` — required by `GET /research/evidence-metadata` (the
  bulkier, provenance-level dataset — see `docs/monetisation-proposal.md`
  "Data licensing" for why this one gets its own, more deliberately-granted
  scope).

A key only needs the scopes it will actually use — `POST /api-keys`
accepts any non-empty subset of the two.

## Using a key

```
GET /research/historical-claims
Authorization: Bearer a1b2c3d4e5f6.9f8e7d6c5b4a...
```

No cookie involved — this is a separate, programmatic auth path from the
browser session (`apiKeys/middleware.ts`'s `requireApiKey`, not
`requireAuth`/`requireEntitlement`).

## Listing your keys

```
GET /api-keys
Cookie: token=<your session JWT>
```

Returns metadata only — `maskedPrefix` (first 4 characters visible, the
rest starred), name, scopes, timestamps. **Never** the secret or the full
prefix in a form that could reconstruct the key.

## Revocation

Admin-only (`docs/admin-operations.md`'s
`POST /admin/api-keys/:id/revoke`) — an owner cannot revoke their own key
through this app today. A revoked key's requests get the same `401`
response as an invalid or unknown key (see "Error responses" below).

## Error responses — deliberately non-enumerating

| Condition | Status | Body |
|---|---|---|
| No `Authorization` header | 401 | `{"error":"Missing or invalid API key"}` |
| Malformed key, unknown prefix, or wrong secret | 401 | same body |
| Expired key | 401 | same body |
| Revoked key | 401 | same body |
| Valid key, owner no longer `RESEARCH` tier | 403 | `{"error":"API key not authorized for this resource"}` |
| Valid key, missing required scope | 403 | same body |
| Valid key, but the endpoint's feature flag is off | 403 | same body |
| Rate limit exceeded | 429 | `{"error":"Rate limit exceeded","resetAt":"..."}` |

An attacker cannot distinguish "this key never existed" from "this key
existed but the secret was wrong" from "this key was revoked" — all three
return byte-identical `401` responses. The specific reason is recorded
internally, in `OperationalEvent` (`eventType: API_KEY_REJECTED`, with an
internal `reason` field), never in the HTTP response.

## Rate limiting

100 requests per 60 seconds, per key (not per user — a user with two keys
gets two independent budgets). Response headers `X-RateLimit-Limit` /
`X-RateLimit-Remaining` are always set, even on success. **Fails open**:
if Redis is unreachable, requests are allowed through rather than blocked
— the reasoning (`docs/public-beta-readiness-audit.md` §5) is that
temporarily-unlimited reads of these already-scoped, non-personal datasets
is a better failure mode than an outage taking down all Research API
traffic. Compare `docs/admin-operations.md`'s admin-grant limiter, which
fails the opposite way for the opposite reason.

## Data returned

`GET /research/historical-claims` — resolved `Claim` rows (id, status,
player/club IDs, transfer type, window, timestamps). `GET
/research/evidence-metadata` — `EvidenceItem` provenance metadata (id,
claim ID, source ID, provenance root, direction, published timestamp) —
**no article text, no title, no excerpt**. Both cap at 500 rows and are
this product's own analysis output, not re-served Sportmonks-sourced
fields — see `docs/monetisation-proposal.md` "Data licensing" for why that
distinction matters and why bulk export stays flag-gated off by default
independent of tier.

## Known limitations

Stated plainly rather than left implicit:

- **No real rate limiting infrastructure beyond the fixed-window Redis
  counter described above** — no distributed quota management, no
  per-plan tiering of limits.
- **No API documentation portal, versioning scheme, or stability
  guarantee** — this is the mechanics of the gate, not a published
  contract.
- **No license-enforcement or attribution-checking** — the data-licensing
  terms referenced in responses (`"license"` field) are a pointer to
  `docs/monetisation-proposal.md`, not a machine-checked agreement.
- **Both endpoints cap at 500 rows with no pagination** — fine for
  validating the packaging, not fine for a real bulk-export product.
