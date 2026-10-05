# Audit module

Controllers declare WHAT to audit via `@Audit(...)`. `AuditInterceptor`
handles WHEN and HOW. Services stay audit-free, with three documented
exceptions.

## Exceptions (manual audit, intentionally NOT via the interceptor)

- **AuthService.login / refresh / logout** — non-CRUD events with custom
  semantics (timing-attack delays, reuse detection, rotation). They call
  `prisma.auditLog.create()` directly with `action=CREATE, resource=AUTH`
  and the event name in `newValues.event`.
- **EntriesService file streaming** (`openStream`) — fire-and-forget
  `FILE_VIEWED` write after the response starts streaming. An interceptor
  cannot safely bracket a streaming response.
- **BulkUploadProcessor** — runs in a BullMQ worker, outside any HTTP
  request (no `req.user`, no interceptor context). Writes `CREATE ENTRY`
  rows directly, same shape as the interceptor would.

## Rules

- Never `await` the audit write on the request path (fire-and-forget).
- Never log passwords, tokens, or full JWTs (see `redact` blocklist).
- Audit failures must never break the request (`AuditService` swallows).
- Handler errors produce NO audit row (nothing was mutated).
- AuditLog rows are immutable (DB trigger `audit_log_immutable`).

## /audit-logs scope

Currently requires GROUP-scope VIEW AUDIT. COMPANY_ADMIN has the grant
in the seed matrix but the endpoint rejects them in the service layer
(GROUP-only gate) until scoped reads land.
TODO(Phase 7c): scoped reads — filter audit rows to userIds within
the caller's COMPANY/PROJECT scopes before returning.

## Streaming endpoints

AuditInterceptor buffers responses via lastValueFrom before firing the
audit write. This breaks streaming (large files, SSE, chunked).
RULE: never apply @Audit to a streaming endpoint. Write the audit
manually with setImmediate inside the handler — see openStream()
in EntriesService for the pattern.
