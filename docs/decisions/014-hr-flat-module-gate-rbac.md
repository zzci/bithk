# ADR-014: HR module keeps flat module-gate RBAC

- Status: Accepted
- Date: 2026-07-04
- Task: [DOC-001](../task/DOC-001.md) · Source finding: AUDIT-20260702-architecture.md → D14 note
  / group review §5 ("weaker-than-siblings")

## Context

Every project-scoped module (issues, procurement, drive, documents) enforces row-level
authorization on top of the module gate: project membership, capabilities, or ownership checks
per row. HR is the exception — it is deliberately flat (`hr.routes.ts` documents this inline):

- Any user whose global role includes the `hr` nav module can read **all** colleagues,
  including salary fields, and can create/edit payroll rows (bonus/deduction amounts).
- Only the payroll `paid` transition is admin-gated (`hr.payroll.routes.ts`).

The 2026-07-02 architecture assessment asked for either an ADR recording this as deliberate or
row-level tightening (e.g. self-vs-colleague scoping for payroll writes).

## Decision

Keep the flat module-gate model. HR access is an organizational trust boundary, not a
per-row one: the operators granted the `hr` module are exactly the people who administer
colleagues and payroll. Row-level scoping would add per-row policy tuples and UI states for a
module whose entire audience is the HR-operator group, with no current requirement to give
non-HR staff partial visibility (e.g. self-service payslips).

Confirmed by the project owner on 2026-07-04: no row-level tightening; file this ADR instead.

## Consequences

- Granting a role the `hr` module grants full HR read/write (except the admin-only `paid`
  transition). Role design must treat `hr` as a sensitive module — do not bundle it into broad
  roles.
- Salary confidentiality relies on module assignment, not per-row masking. Audit events on HR
  writes remain the compensating control.
- PAT scoping still applies: a token without `hr` write scope cannot mutate HR data regardless
  of the user's role (ADR-013).

## Rejected alternative

Row-level scoping (self vs colleague; payroll writes gated on a dedicated `hr.manage`
capability). Rejected as speculative complexity today.

## Revisit triggers

- A self-service surface (employees viewing their own payslips/leave) is requested — that
  requires row-level "self" scoping and per-field masking.
- HR module membership grows beyond the trusted operator group.
- A compliance requirement (e.g. salary-data segregation) lands.
