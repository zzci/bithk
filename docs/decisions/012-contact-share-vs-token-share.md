# 012 — Contact sharing uses the ACL grant model, not the token share system

- Status: accepted
- Date: 2026-06-07
- Review by: 2026-12-01
- Scope: how the contacts module exposes "share this contact" in the UI and
  backend. Specifically `apps/web/src/app/routes/_app/contacts/-contact-share-dialog.tsx`
  (the contact share dialog) and the `apps/api/src/modules/contact` `grant` /
  `revoke` endpoints, contrasted with the unified token-based share system in
  `apps/web/src/shared/components/share/` + `apps/api/src/modules/share`.
- Related: decision 011 (contact single-table Party model). The contact
  `visibility` + `confidential` sensitivity model lives in
  `apps/api/src/modules/contact/schema.ts`.

## Context

The codebase has one shared, resource-agnostic share system under
`shared/components/share/`. Its app-root `ShareDialogHost` + `useShare`/`openShare`
store are adopted by ~15 surfaces across drive, documents, projects, issues,
procurements, and the team directory, and it is backed by the `share` module:

- a single polymorphic `shares` table keyed by `(resourceType, resourceId)`;
- `SHARE_RESOURCE_TYPES = ['document', 'drive_entry']` with an adapter registry
  (`registerShareAdapter` / `findShareAdapter`), mirrored on the frontend by
  `share/register`;
- `SHARE_TYPES = ['direct', 'public_link']`: a **direct** share targets a user,
  while a **public_link** carries a random `token`, an optional argon2id
  `password`, and an `expiresAt`. The token is the capability — anyone holding the
  link can reach the resource through `/shared/:token` without an account.

The contact share dialog does **not** use any of that. It re-implements its own
dialog against a separate backend:

- `useGrantContact` / `useRevokeContact` POST to `/contacts/:id/grant` and
  `/contacts/:id/revoke`;
- the target is a **user *or* a group** (`{ userId }` | `{ groupId }`), not just a
  user, and never a public link;
- server-side, `contactService.grant` / `revoke` write **Zanzibar relation
  tuples** (`createTuple` / `deleteTupleByKey` in the `policy` module), i.e. it
  edits the authorization graph directly. There is no `shares` row, no token, no
  password, no expiry.

This grant model is layered on top of a contact's own **sensitivity** — the
derived `public` / `private` / `confidential` state computed from the
`visibility` + `confidential` columns (decision 011) — which the token share
system has no equivalent of.

So two share UIs coexist with deliberately different semantics. This record exists
so the next audit pass (human or tool) does not "consolidate" the contact dialog
into the token share system on the assumption it is accidental duplication.

## Decision

1. **Keep contact sharing on the ACL grant model, separate from the token share
   system.** The contact share dialog and its `grant` / `revoke` endpoints stay as
   they are. We do **not** register `contact` as a `SHARE_RESOURCE_TYPES` entry or
   route it through `ShareDialogHost` / `openShare`.

2. **The duplication is intentional, not dead code.** The contact dialog is a
   small, purpose-built control for a different access model (direct user/group
   ACL + sensitivity). It is not an un-migrated copy of `ShareDialog` and should
   not be deleted in favor of it.

3. **Registering contacts as a share-registry resource type is recorded as a
   *future option*, not a current task.** It is the migration target **only if**
   contacts ever need token-based capabilities (public links, password-protected
   links, expiry). See Sunset / review.

## Rationale

- **The two models answer different questions.** Token shares grant *capability
  by possession of a secret*: a public/direct link to a resource, optionally
  password- and expiry-gated, reachable without authentication. Contact grants
  edit *who in the identity system may see a contact*: a direct ACL over
  authenticated users and groups, with no link, no token, no anonymous access.
  These are not two skins over one mechanism; they persist to different stores
  (`shares` table vs `policy` relation tuples) and have different threat models.

- **Group targets and sensitivity have no token-share analog.** Contact sharing
  targets groups, and operates against the per-contact `public` / `private` /
  `confidential` sensitivity. The token share system models neither. Forcing
  contacts into `SHARE_RESOURCE_TYPES` would mean either bolting these concepts
  onto the generic share schema (leaking contact-specific concerns into a
  resource-agnostic table) or leaving them unrepresented.

- **A premature unification would hurt, not help.** Per the repo's
  anti-over-engineering principle, a "generic" abstraction is only worth it when
  the behaviour genuinely repeats. Here the shared parts (a dialog shell, a
  target picker) are thin, while the access semantics diverge sharply. Collapsing
  them would add a contact-shaped special case to every layer of the share
  pipeline (schema, adapter, public route, preview registry) for no behavioural
  gain — the classic case where the duplicated, purpose-built code is the simpler
  and more readable choice.

- **Writing it down prevents a wrong "fix".** "Two share dialogs" reads like an
  oversight at a glance. Recording why they differ keeps a future cleanup from
  deleting the contact dialog or wiring contacts through the token system and
  silently changing the access model.

## Alternatives considered

- **Register `contact` as a `SHARE_RESOURCE_TYPES` adapter and route the contact
  dialog through `ShareDialogHost` / `openShare`.** Rejected for now: contacts
  have no token / public-link / expiry use case, and the grant model (user *and*
  group ACL + sensitivity) does not fit the `shares` schema. This is the
  documented future option, not a present need.

- **Extend the token share system to support direct user/group ACL grants
  alongside tokens.** Rejected: it would generalise the share schema to absorb a
  second, structurally different access model purely to host one consumer,
  complicating the system that 15 surfaces already depend on. The contact module
  already has a fitting mechanism in the `policy` (Zanzibar) tuples.

- **Delete the contact share dialog as duplicate UI.** Rejected: it is the only
  surface for contact ACL grants; there is no equivalent in the token system to
  fall back to.

## Sunset / review

Revisit by **2026-12-01**. Migrate contact sharing onto the share registry
(register a `contact` resource type with its own adapter) **if** contacts ever
need token-based capabilities — public or password-protected links, link expiry,
or anonymous (`/shared/:token`) access. If that happens, the direct user/group
ACL grant would either move under the new adapter or coexist with it, and this
decision would be superseded rather than extended. Absent that need, the two
share models stay separate.
