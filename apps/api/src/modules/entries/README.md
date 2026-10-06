# Entries Module

Upload, listing, streaming, audit and bulk-upload of TMG archive entries (PDFs).

## Endpoints

- `POST /entries` — single upload (multipart, year/company/project fields).
- `GET /entries` — cursor-paginated list; filters: `companyId`, `projectId`,
  `year`, `typePrefix`, `serial` (exact), `serialFrom`/`serialTo` (range),
  `q`, `includeDeleted`.
- `GET /entries/:id` — detail (includes soft-deleted rows for restore UI).
- `GET /entries/:id/file` — streamed PDF (Range supported, CORS headers set
  explicitly because the response bypasses the NestJS pipeline).
- `POST /entries/bulk-upload` — queued multi-file upload (≤500 files, ≤2 GB).
- `POST /entries/bulk-upload/preview` — pre-flight conflict check for the
  bulk UI: parses filenames, batch-checks duplicate serials (company+year)
  and duplicate hashes (global) without staging any file.
- `GET /entries/bulk-upload/:jobId` — job report (Redis-backed, 24 h TTL).
- `POST /entries/bulk-upload/:jobId/cancel` — best-effort cancellation.

## Domain Rules

- **Serial format**: exactly 10 digits, zero-padded, `.pdf` extension.
  Allowed type prefixes: `62`, `63`, `67`.
- **Uniqueness**: serials are unique per `(companyId, year, serial)` — see
  `@@unique([companyId, year, serial])` in `prisma/schema.prisma`.
  - **TODO(schema-review):** the user reports all TMG companies use a SINGLE
    SAP instance, which would make serials globally unique per year. Confirm
    with Dr. Tarek before changing anything. If confirmed, the constraint
    becomes `@@unique([year, serial])` and requires a data-integrity
    migration (existing rows must be checked for cross-company collisions
    first). Do NOT change the schema until confirmed.
- **File hash**: SHA-256 of the file content, unique per file *regardless of
  scope* — the same document re-uploaded under another company/year is still
  a duplicate ("This file is already uploaded").
- **Scope**: every read/write is filtered by the caller's RBAC scope
  (GROUP > COMPANY > PROJECT) via `buildEntryWhere` — never bypass it.
- **Soft delete**: rows keep `deletedAt`; files stay in storage but are
  not streamable while deleted (restore re-enables them).
- **Audit**: immutable `AuditLog` rows (DB trigger enforces no UPDATE/
  DELETE). Uploads are audited by the interceptor, not the service.
