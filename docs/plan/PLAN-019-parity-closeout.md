# PLAN-019 Parity Closeout

- **status**: complete
- **createdAt**: 2026-05-25
- **relatedTask**: UI-004
- **campaignId**: l1-mwo9qmid-20260525155159

## Verification

| Gate | Result |
| --- | --- |
| Initial `bun run check` | Pass |
| Initial `bun run smoke` | Pass |
| Screenshot capture | Pass |
| Screenshot artifacts | `docs/plan/parity-shots/PLAN-019-F/` |

Screenshots were captured with Playwright at 1440x1000. Current implementation screenshots use the test fixtures in `tests/fixtures/{ships,projects,contacts}.ts` and intercept `/api/**`. Prototype screenshots use `https://fr.ds.cc/bit.html`.

## Side-By-Side Qualitative Comparison

| Module / screen | Prototype | Current | Result | Notes |
| --- | --- | --- | --- | --- |
| Ships list | [prototype](parity-shots/PLAN-019-F/prototype/ships-list.png) | [current](parity-shots/PLAN-019-F/current/ships-list.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Overall card layout, lifecycle filters, KPI strip, and vessel illustrations match the intended surface. Remaining gaps are backend-gated: ship type taxonomy (`ship.type` or normalized type API), per-ship project/equipment aggregate fields, and fleet equipment total. |
| Ship detail overview | [prototype](parity-shots/PLAN-019-F/prototype/ship-detail-overview.png) | [current](parity-shots/PLAN-019-F/current/ship-detail-overview.png) | MATCHES / BACKEND-GATED | Hero, metrics, tabs, lifecycle/status chips, project/equipment/maintenance summaries, and base-project context are present. Missing overdue PM metric needs maintenance scheduling fields: `interval`, `nextDue`, `overdue`, and template source metadata. |
| Ship detail profile | [prototype](parity-shots/PLAN-019-F/prototype/ship-detail-profile.png) | [current](parity-shots/PLAN-019-F/current/ship-detail-profile.png) | MATCHES | Dedicated profile tab is present and backed by current `ShipView` fields. |
| Ship detail maintenance | [prototype](parity-shots/PLAN-019-F/prototype/ship-detail-maintenance.png) | [current](parity-shots/PLAN-019-F/current/ship-detail-maintenance.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Segmented templates/work-orders view and global copy control are present. Prototype due/source badges remain blocked by missing template fields: `fromGlobalId`, `interval`, `nextDue`, `overdue`. |
| Projects list | [prototype](parity-shots/PLAN-019-F/prototype/projects-list.png) | [current](parity-shots/PLAN-019-F/current/projects-list.png) | RESIDUAL VISUAL GAP FIXED / BACKEND-GATED | Fixed in this pass: grid now reaches three columns on wide desktop, matching the prototype density. Remaining gaps require project list aggregate fields: `memberCount`, `issueCount`, `procurementCount`, `fileCount`, owner display, and ship summary/covered ship count. |
| Project detail overview | [prototype](parity-shots/PLAN-019-F/prototype/project-detail-overview.png) | [current](parity-shots/PLAN-019-F/current/project-detail-overview.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Current screen has hero, key metrics, tabs, description, key info, members, and procurement categories. Missing ship context, supplier preview, recent activity, and file count need `ProjectView` ship summary, project-linked contact/supplier data, activity feed, and Drive aggregate count. |
| Project detail issues | [prototype](parity-shots/PLAN-019-F/prototype/project-detail-issues.png) | [current](parity-shots/PLAN-019-F/current/project-detail-issues.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Current API-backed status chips, list/kanban toggle, table, and issue drawer are present. Prototype work-order columns remain blocked by missing fields: category, estimated/actual hours, material readiness/count, dependency count, approval state/steps, and checklist progress. |
| Project detail procurement | [prototype](parity-shots/PLAN-019-F/prototype/project-detail-procurement.png) | [current](parity-shots/PLAN-019-F/current/project-detail-procurement.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Current status pipeline and amount/count summary are present. Prototype-only columns remain blocked by missing procurement fields: requisition number, unit, unit price, ETA, urgent flag, plus real import endpoint. |
| Project detail members | [prototype](parity-shots/PLAN-019-F/prototype/project-detail-members.png) | [current](parity-shots/PLAN-019-F/current/project-detail-members.png) | MATCHES | Dedicated members tab is present and uses current members/roles APIs without adding fake project data. |
| Contacts directory | [prototype](parity-shots/PLAN-019-F/prototype/contacts-directory.png) | [current](parity-shots/PLAN-019-F/current/contacts-directory.png) | RESIDUAL VISUAL GAP / BACKEND-GATED | Current directory preserves masking, visibility, confidential badges, status filters, tag filter, and management actions. Prototype type/rating/reference/import/export model needs contact type taxonomy/settings, rating, reverse referenced-project counts, procurement history by contact/supplier, and real import/export endpoints. |

## Fixes Applied

| File | Change | Verification |
| --- | --- | --- |
| `apps/web/src/app/routes/_app/projects/index.lazy.tsx` | Project grid now uses three columns at `xl` desktop width. | Re-captured `docs/plan/parity-shots/PLAN-019-F/current/projects-list.png`. |
| `tests/parity/capture-plan-019.ts` | Added reusable Playwright capture script for current fixtures and reference prototype. | `bun tests/parity/capture-plan-019.ts` passes. |

## Accepted Backend-Gated Gaps

These are carried forward from PLAN-019 escalations and were not faked in the frontend:

| Area | Missing API / field |
| --- | --- |
| Ships list | `ship.type` or normalized ship type API; list-level fleet summary; per-ship `projectCount`; per-ship `equipmentCount`; fleet `equipmentTotal`. |
| Ship maintenance | Maintenance template `fromGlobalId`, `interval`, `nextDue`, `overdue`, and copied-from-global/source metadata. |
| Project list | List summary fields for `memberCount`, `issueCount`, `procurementCount`, `fileCount`, owner display, project ship summary, and covered ship count. |
| Project detail | Project-to-ship summary in `ProjectView` or a dedicated endpoint; Drive aggregate file count; project-linked suppliers/contacts; recent activity feed. |
| Work orders | Issue/work-order category, estimated hours, actual hours, material readiness/count, dependency count, approval workflow state/steps, checklist progress. |
| Procurement | Requisition number, unit, unit price, ETA, urgent flag, and real import endpoint. |
| Contacts | Contact type taxonomy/settings, rating, reverse referenced-project counts, procurement history by contact/supplier, and real import/export endpoints. |

## Self-Review

- Visual fix is confined to `apps/web/src/app/routes/_app/projects/index.lazy.tsx`.
- Screenshot tooling is confined to `tests/parity/capture-plan-019.ts`.
- No backend, schema, shared hook, permission, masking, or route contract changes were made.
- No fake frontend fields were added for backend-gated prototype data.
- No locale keys were added, so en/zh parity is unchanged.
