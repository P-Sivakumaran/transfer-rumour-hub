# CHAP decision attestation (pilot)

This project has a local CHAP coordinator wired in as an MCP server (`.mcp.json`,
tools/chap/). It exposes `chap.*` tools for creating a signed, hash-chained audit
record of decisions. Audit log lives at `.chap/chap.db` (gitignored, local only).

## When to attest

Only at real decision points — not on every tool call. Attest when:
- a plan is approved before non-trivial implementation work starts
- a schema/migration change is about to run
- a security- or PoLP-relevant change is made (see `docs/` for prior PoLP phases)
- a sync/integration fix goes live after being broken

Do not attest routine reads, greps, or trivial edits — that's noise, not decisions.

## Workflow

1. First use in this repo: `chap.workspace.create` with `workspace: "wsp_transfer_rumour_hub"`,
   `profiles: ["core/1.0", "review/1.0", "audit-scitt/1.0"]`, `mode: "production"`.
   Then `chap.participant.join` (needs `from`: the joining participant's own URI, e.g.
   `human:you@example.org` or `agent:claude-code`, plus `type`: `human`/`agent`/`service`)
   for both the human and `agent:claude-code`. One-time; skip if `chap.workspace.describe`
   shows it already exists.
2. At a decision point: `chap.task.create` with `from` (delegator URI), `kind:
   "decision:<short-slug>"`, `assignee` (must be a joined participant), and `input`
   summarizing what's being decided and why. Returns `task_id`.
3. `chap.task.complete` with `from`, `task_id`, and `output` (the artefact/decision content) —
   tasks must be completed before they can go to review.
4. `chap.review.request` with `from`, `task_id`, `to` (reviewer URI or array), and `artefact`
   (same content as `output`) — this is what actually puts the task in a reviewable state.
5. The reviewer calls `chap.decide.approve` or `chap.decide.reject` with `from`, `task_id`
   (not `task`), and optional `comment`.
6. To check the trail: `chap.audit.read` (hash-chained via `prev_hash`) or
   `chap.audit.verify_chain` (audit-scitt/1.0) to confirm no tampering.

Full param names matter — the server returns `-32602 Missing field: from` /
`Missing field: task_id` on the old shorthand, and `chap.decide.approve` on a task still in
`created` state fails with `-32010 Task not awaiting review`. Verified working end-to-end
2026-08-22 (13 chained entries, `chap.audit.verify_chain` → `ok: true`).

## Known limitation

`security-signed/1.0` profile is not enabled, so entries are hash-chained
(tamper-evident) but not per-participant cryptographically signed. Enable that
profile + register keys if non-repudiation (not just tamper-evidence) is needed later.

## Maturity note

`@brightbeamai/chap-coordinator` / `-mcp` are first releases (v0.2.10/0.2.11,
published 2026-08-20). Treat breaking changes as likely; re-verify after any
version bump before trusting the audit trail.
