# FEAT-018 — Project work orders reference ship worklists

- Status: In Progress
- Plan: [PLAN-057](../plan/PLAN-057.md)
- Campaign: l1-75ymcfnr-wlref-20260603153351
- Owner: L2 52r11h7b dispatch
- Created: 2026-06-03

## Summary

Let a ship base project (`projects.shipId` set) reference one of its ship's
worklists (or a global worklist) when creating a work order (issue): the picker
pre-fills the issue title (worklist name) and description (rendered checklist +
precautions) and the created issue records the referenced worklist id via the
existing `issue_references` mechanism (refType `worklist`). No new column / no
migration — see PLAN-057 "Key design decision".

## Lanes (L3)

- **L3-1 backend** — expose `shipId` on `ProjectView`/project detail; add
  `GET /projects/:projectId/referenceable-worklists` (`{ ship, global }`) +
  `listReferenceableWorklists` helper; targeted tests.
- **L3-2 frontend** (deps: L3-1) — "清单" picker button in the create-issue
  dialog (ship-base-project only), searchable picker grouped 本船/全局, populate
  title+description, removable "引用清单" chip, pass `references` on create,
  surface the reference in the issue detail panel; i18n en+zh; tests.

## Status notes

- 2026-06-03: Investigation + plan (PLAN-057). Discovered the issue→worklist
  reference infra (table/service/routes/create-path + web client type) already
  exists; backend work reduced to `shipId` exposure + a referenceable-worklists
  endpoint. L3-1 dispatched; L3-2 created (planned, deps=L3-1).
