# Users module

## User visibility

A user with zero UserRole rows resolves to a `[GROUP]`-only scope chain
(see ScopeResolver USER case), so only callers with GROUP-scoped VIEW USER
can see them. POST /users requires at least one initial role (with an
explicit scope) to prevent creating such orphans. If you need a role-less
user later, revoke their last role explicitly (and accept they become
invisible to COMPANY_ADMIN).
