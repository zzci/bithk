# 003 — Fail-closed 404 existence policy (404 hides existence, 403 is capability-denial)

- Status: accepted
- Date: 2026-05-23
- Review by: 2026-11-23
- Scope: `apps/api` authorization layer — policy middleware
  (`modules/policy/middleware.ts`, `registry.ts`), document
  (`document.permission.ts`, `document.routes.ts`, `document.share-adapter.ts`),
  drive (`drive.permission.ts`, `drive.routes.ts`), file (`file.routes.ts`).
  Reference implementations (already compliant, unchanged): project
  (`project.routes.ts`), issue (`issue.routes.ts`), item comment routes
  (`item/comment.routes.ts`).

## Context

Read/by-id endpoints disagreed on what to return when an authenticated caller
had **no access relationship** to a resource. Project, issue and comment routes
returned `404` (hiding existence); document and drive read paths, the document
share adapter, and the generic file `/content` route returned `403`. A `403`
on a by-id GET leaks that the resource exists to anyone who can guess or
enumerate an id — an existence-disclosure side channel that is inconsistent
with the owner-scoped model the rest of the API already enforces.

## Decision

One rule across the API:

1. A caller with **no access relationship** to a resource (not owner, not a
   member, no share/grant) receives **404** on any read/GET or by-id access.
   Existence is hidden.
2. **403** is reserved for callers who **can already see** the resource
   (owner / member / granted) but lack a **specific capability or action**
   (e.g. a project member without a capability, a document viewer without
   `manage`, a drive viewer without `delete`/`share`, a write attempted
   without write permission). These are NOT converted to 404.

`project.routes.ts` is the reference: non-member → 404, member-lacking-capability
→ 403. It is unchanged.

### Mechanism

- Resources opt in by declaring `readAction` on their policy definition (the
  `viewer`-level read action). The policy gate (`policyMiddleware` and
  `requirePermission`) then routes a failed `can()` check through
  `accessDenied`: if the caller fails the `readAction` check (or the requested
  action *is* the read action), it returns `404`; otherwise `403`. Resources
  that omit `readAction` keep the legacy `403`-on-any-denial behaviour.
- `document` sets `readAction: "document:read"`; `drive` sets
  `readAction: "drive:read"`.
- Defense-in-depth handler checks were aligned to the same shape: document
  read/attachment GETs and the document share adapter check readability first
  (404) before asserting the capability (403); `assertEntryCapability` returns
  404 when the actor holds **no** capability on the entry and 403 when it holds
  some but not the requested one; the file `/content` route returns 404 for a
  barred reader, matching the sibling `/metadata` route.

## Rationale

A uniform rule removes the enumeration side channel and matches the owner-scoped
data model: a resource you have no relationship to should be indistinguishable
from one that does not exist. Preserving 403 for capability-denial keeps error
states accurate for callers who legitimately see the resource, so the UI can
still render "permission denied" rather than a misleading "not found".

## Consequences

- Some previously-`403` read responses are now `404`. Contract tests were
  updated to the hardened behaviour (e.g. "admin A cannot read admin B's
  unshared document" now expects 404), and member-but-no-capability cases were
  locked in as 403 so rule 1 is not over-applied.
- This is a breaking change to the HTTP error contract for no-access reads;
  accepted because the project is pre-release.

## Alternatives considered

- **Per-handler ad-hoc fixes** — rejected: scatters the rule and drifts.
- **Always 404 on any denial** — rejected: erases the useful 403 signal for
  callers who can see the resource but lack a capability.
