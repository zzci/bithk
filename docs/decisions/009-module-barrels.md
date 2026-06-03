# 009 — Keep the `apps/api/src/modules/*/index.ts` module barrels

- Status: accepted
- Date: 2026-06-03
- Review by: 2026-12-01
- Scope: the 19 module barrels at `apps/api/src/modules/*/index.ts` and the
  policy on importing module internals across the API.
- Related: campaign l1-w6c655lo-fix (audit remediation), finding
  REFACTOR-AUDIT-015 ("half-applied / droppable barrel").

## Context

The audit raised REFACTOR-AUDIT-015 against the 19 per-module `index.ts`
barrels, on the premise that they were a half-applied convention — a barrel
layer that some call sites bypass with deep imports, and therefore droppable
dead code that could be removed (optionally backed by an
`eslint no-restricted-imports` rule to force everything through the barrel).

That premise is incorrect. The barrels are not a passive re-export façade; they
are the **route-wiring + module-registration surface**. Importing a barrel
fires import-time side effects that wire the module into the application's
cross-cutting registries. Removing a barrel — or letting it be tree-shaken away
because "nothing imports it" — would silently drop those registrations.

Concrete side effects, verified across the 19 barrels:

- **Backup contributions** — 15 of the 19 barrels call
  `registerBackupContribution(...)` at module load (e.g. `account`, `file`,
  `drive`, `contact`, `cron`, `document`, `item`, `policy`, `project`, `ship`,
  `share`, `system`, …). The backup/restore manifest is assembled from whatever
  registered itself; a dropped barrel is a silently missing backup section.
- **Auth provider** — `account/index.ts` calls
  `registerAuthProvider(oauthSessionAuthProvider)`, registering the OAuth
  session auth strategy that the middleware resolves at request time.
- **Permission hooks** — `item/index.ts` registers the attachment and
  comment-attachment permission hooks; `project/index.ts` and `ship/index.ts`
  each register their cover-image permission hook.
- **Storage driver** — `file/index.ts` does a side-effect import of
  `./storage/local`, by which the local storage driver self-registers into the
  driver registry; `initFileModule(config)` later only *selects* the active
  driver. `drive/index.ts` likewise side-effect-imports
  `./drive.file-permission` and `./drive.share-adapter` to wire the drive share
  adapter into the share module.

In other words, "is this barrel imported?" is the wrong question: the barrel's
*import* is the registration. The barrels are load-bearing, not dead.

## Decision

1. **Keep all 19 module barrels.** They are the registration entry point for
   each module and must continue to be imported at app-composition time so their
   import-time side effects run.

2. **Deep imports into module internals remain an accepted pattern.** We do
   **not** add an `eslint no-restricted-imports` rule to funnel every call site
   through the barrel. Such a rule would force large, mechanical churn across the
   codebase (rewriting every `@/modules/x/x.service` import to `@/modules/x`)
   for no correctness or safety benefit, and would risk turning incidental
   barrel imports into the thing that keeps a registration alive — making the
   wiring *more* fragile, not less.

3. **The REFACTOR-AUDIT-015 finding is recorded as incorrect.** Its
   "half-applied / droppable barrel" framing misread a registration surface as
   dead re-export code. No source change is warranted; this decision is the
   resolution of that finding.

## Rationale

- **Import-time registration is the contract.** The codebase deliberately uses
  side-effect imports (backup, auth, permission hooks, storage/share drivers) so
  that adding a module is a single barrel import rather than a patch to a central
  `initX` switchboard. Deleting the barrel breaks that contract invisibly — no
  type error, just a missing backup section or an unregistered driver at
  runtime.
- **No churn for no benefit.** A `no-restricted-imports` lockdown would touch a
  large number of files purely to enforce a stylistic funnel. Deep imports are
  already safe here because the registrations live in the barrel, not in the
  internals being deep-imported.
- **Clarity over a false positive.** Writing down *why* the barrels exist
  prevents the next audit pass (human or tool) from re-flagging them as dead
  code and attempting the same removal.

## Alternatives considered

- **Delete/trim the barrels (the finding's suggestion).** Rejected: this drops
  the registration side effects and is the actual footgun the finding mistook the
  barrels for.
- **Add `eslint no-restricted-imports` to force all imports through the
  barrel.** Rejected: large mechanical churn, no safety gain, and it couples
  registration liveness to incidental imports.

## Sunset / review

Revisit by **2026-12-01**. This is a dev-phase decision; if the module-wiring
strategy changes (for example, an explicit central registration manifest that no
longer relies on import-time side effects), re-evaluate whether the barrels are
still load-bearing and supersede this decision rather than silently deleting
them.
