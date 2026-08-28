# Ship Module — the maritime project sections

The `ship` module is **not a module of its own aggregate any more**. Since
[ADR-015](../decisions/015-projects-as-sections.md) it owns three *sections* of
the [`project`](./project.md) module plus two global admin vocabularies. A ship
**is** a project — one created with the `ship` preset, or one that mounted the
maritime sections later. There is no `ships` table, no `/api/ships/*` route
tree, no `ships` nav module and no `ships` PAT scope.

| Section | What it adds | Provisioned on mount |
| ------- | ------------ | -------------------- |
| `ship-profile` | The vessel particulars (`ship_profiles`, 1:1 with the project) | Inserts the profile row |
| `equipment` | Equipment inventory + the project's own equipment-category set | Copies the global equipment-category template |
| `worklist` | Project-level worklists, authored in place or copied from the global knowledge base | — (starts empty) |

All three register themselves from `modules/ship/index.ts`, the module's own
barrel ([ADR-009](../decisions/009-module-barrels.md)), so the project module
never imports the ship module.

## What lives on the project, not here

Identity, name, description, code, status, cover image, tags, creator, version,
soft-delete, members, roles and the sub-project hierarchy are all **project**
concerns. `ship_profiles` holds only what is specific to a vessel — which is why
the maritime attributes are a side table rather than fourteen nullable columns
on `projects`, and why "section mounted" and "profile row exists" stay
equivalent.

Two consequences worth stating explicitly:

- **The ship cover is a plain `project_cover`.** The `ship_cover`
  `file_references` owner type is gone, along with the separate ship-cover
  permission hook and the "inherited cover" fallback. A ship-type project uses
  `PUT/DELETE /api/projects/:id/cover-image` like any other project.
- **A ship-type project deletes through the normal `softDeleteProject`
  cascade** (`project.manage`, sub-projects unlinked, issue/procurement items
  soft-deleted). The old admin-only ship delete does not exist.

## Database

| Table | Purpose |
| ----- | ------- |
| `ship_profiles` | The `ship-profile` section's 1:1 side table. PK = `project_id` (→ `projects`, cascade). `hull_number` (**NOT NULL + globally UNIQUE**), `ship_status` (`under_construction` \| `active` \| `underway` \| `in_maintenance` \| `laid_up` \| `retired`, default `laid_up`), and the particulars: `model`, `builder`, `build_year`, `length_overall`, `beam`, `draft`, `air_draft`, `gross_tonnage`, `imo_number`, `mmsi`, `call_sign`, `flag_state`, `registry_port`, `owner_name`. |
| `global_equipment_categories` | Admin-maintained bilingual template (`name_zh` / `name_en`, each globally unique). **Not** referenced by equipment — its rows are copied per project. |
| `equipment_manufacturers` | Admin-maintained brand vocabulary. Unlike categories it is **not** copied: equipment references a row here directly. Proper nouns, so one canonical `name`. |
| `ship_equipment_categories` | The project's own category set, seeded from the template when `equipment` is provisioned, then independently editable. Names unique **within a project**. |
| `ship_equipment` | Equipment inventory for a project with `equipment` mounted. `category_id` → `ship_equipment_categories` (set null), `manufacturer_id` → `equipment_manufacturers` (set null). |
| `worklists` | `project_id` NULL = a **global** knowledge-base entry (copy source only); a value = a project-level copy. |

The `ship_` table-name prefix stays: these are maritime-domain tables owned by
this module. See [ADR-010](../decisions/010-bilingual-vocab-storage.md) for the
bilingual-vocabulary storage rule (that ADR predates the fold — read "per-ship"
there as "per project with the `equipment` section mounted").

### `hull_number`

`hull_number` is the former `ships.code`: **mutable and case-preserving** —
deliberately unlike `projects.code`, which is immutable and lowercased. It is
NOT NULL and UNIQUE, so a ship-preset create that supplies no hull number
auto-generates `S-<last 8 chars of the project ULID, uppercased>`, which the
operator can rename afterwards. A collision surfaces as a clean
`422 { hullNumber: "Already exists" }`, not a 500.

There is **no `description` column on `ship_profiles`**: the vessel description
folds into `projects.description`. One project has exactly one description.

## Routes

Mounted under `protectedRoutes`; `authRequired` throughout. `:projectId` is the
project `short_id`. Every project-scoped route is wrapped in
`requireSection(<key>)`, so a project that has not mounted the section answers
404 — a general project has no ship surface at all.

### `ship-profile`

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/api/projects/:projectId/ship-profile` | project member (fail-closed 404) |
| PUT | `/api/projects/:projectId/ship-profile` | `project.manage` (403) |

### `equipment`

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/api/projects/:projectId/equipment` | member |
| POST | `/api/projects/:projectId/equipment` | `project.manage` |
| GET / PATCH / DELETE | `/api/projects/:projectId/equipment/:equipmentId` | member / `project.manage` |
| GET | `/api/projects/:projectId/equipment-categories` | member |
| POST | `/api/projects/:projectId/equipment-categories` | `project.manage` |
| GET / PATCH / DELETE | `/api/projects/:projectId/equipment-categories/:categoryId` | member / `project.manage` |

### `worklist`

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/api/projects/:projectId/worklists` | member. Filter: repeated `tagId=` (OR semantics). |
| POST | `/api/projects/:projectId/worklists` | `project.manage`. Either from scratch, or a **one-time copy** of a global entry via `fromGlobalId` (name / checklist / precautions / tags snapshotted; independent thereafter). |
| GET / PATCH / DELETE | `/api/projects/:projectId/worklists/:id` | member / `project.manage` |
| GET | `/api/projects/:projectId/referenceable-worklists` | member. Payload keeps its `{ ship, global }` shape — the `ship` group now means "**this project's own** worklists". |

### Global vocabularies (admin)

These are **not** sections — they are app-wide admin vocabularies, mounted
outside any project and kept `adminRequired` (they are not group-grantable).
Since the fold they sit under the **`projects`** PAT token scope.

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/api/worklists` | authenticated |
| POST / PATCH / DELETE | `/api/worklists[/:id]` | **admin** |
| GET | `/api/global-equipment-categories` | **admin** |
| POST / PATCH / DELETE | `/api/global-equipment-categories[/:id]` | **admin** |
| GET / POST / PATCH / DELETE | `/api/global-equipment-manufacturers[/:id]` | **admin** |

## Permissions

The three sections declare **no capabilities of their own**. They keep the
gating they had before the fold: **read = any project member** (fail-closed 404
via `requireProjectRead`), **write = `project.manage`** (403 via
`requireProjectManage`). App admins bypass both. That is why the fold needed no
role migration.

Because the `ships` module-gate key is gone, a group granted the **`projects`**
module now reaches ship data. See the module-gate widening note in
[architecture.md](../architecture.md#authorization-model).

## File layout

```text
apps/api/src/modules/ship/
  schema.ts                                # ship_profiles, ship_equipment[_categories],
                                           # global_equipment_categories, equipment_manufacturers, worklists
  ship.profile.service.ts                  # profile view/CRUD + provisionShipProfileTx (sync)
  ship.equipment.service.ts                # equipment CRUD
  ship.ship-equipment-category.service.ts  # per-project categories + seedEquipmentCategoriesTx (sync)
  ship.global-equipment-category.service.ts
  ship.global-equipment-manufacturer.service.ts
  ship.worklist.service.ts                 # project + global worklists, and worklistRoutes()
  ship.routes.ts                           # /api/projects/:projectId/{ship-profile,equipment,...}
                                           # + /api/global-equipment-*
  ship.backup.ts                           # backup contribution
  index.ts                                 # route export + backup + the three registerProjectSection calls
```

## Provisioning

`provisionShipProfileTx` and `seedEquipmentCategoriesTx` are **synchronous**, as
`ProjectSectionDefinition.provision` requires — bun:sqlite transactions are
synchronous, so a write deferred past an `await` would land after COMMIT. Both
run on the create-time preset path **and** on a later `mountSection`, so a
general project promoted to a ship is seeded identically.

The `ship-profile` hook validates its own `sectionData["ship-profile"]` slice
(`shipProfileSectionDataSchema`) — the project module hands the value through
untyped and never learns its shape.

## Backup

`shipBackupContribution` — name `ships`; tables `global_equipment_categories`,
`equipment_manufacturers`, `ship_profiles`, `ship_equipment_categories`,
`ship_equipment`, `worklists` (parents before children, so per-module insert
order alone satisfies the FK chain); deps `["users", "projects"]`.

With `projects.ship_id` gone this is a **one-way** dependency: the pre-fold
`projects <-> ships` cycle no longer exists. See
[backup.md](./backup.md) and [ADR-004](../decisions/004-ship-project-cycle-and-restore.md)
(superseded).

## Web surface

There is no `/ships` route tree. Ship material renders as project detail tabs
driven by the web section registry
(`apps/web/src/app/routes/_app/projects/-project-sections.ts`): `ship-profile` →
the "Details" tab (`/projects/$projectId/profile`), `equipment` →
`/projects/$projectId/equipment`, `worklist` → `/projects/$projectId/worklist`.

The sidebar keeps a **"Ships"** entry, but it is a *preset link* into the
projects list — `/projects?section=ship-profile` — gated on the `projects`
module, not a second route tree. The list filter labels that value "Ships" while
the detail tab says "Details": same section, two vocabularies.

The **sub-projects** tab is gated on `ship-profile` (it replaced the old
ship↔project binding surface), even though `/projects/:id/children` exists for
every project on the API.

## Out of scope

- Maintenance templates and maintenance-order views. The former
  `/api/ships/:shipShortId/maintenance-orders` aggregate is gone; work orders
  are ordinary project issues in the [`issue`](./issue.md) section.
- Ship type taxonomy, fleet-wide aggregates, PM due/overdue scheduling.
- Any per-section membership or config — see the
  [ADR-015](../decisions/015-projects-as-sections.md) non-goals.
