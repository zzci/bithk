# Modules

Per-module functional reference. Each file describes what a module does, the
HTTP routes it owns, the database tables it owns, and how its features are
configured. For *how to add a module* or *how the module system works in
general*, see [`../develop/module/`](../develop/module/).

## Reference modules (template surface)

These ship with the template and are owned by upstream — keep them in sync
when you merge from upstream. See
[`../develop/forking.md`](../develop/forking.md) § "Template surface vs your
application".

| Module | Page |
|---|---|
| `account` (users, auth, groups, TOTP, single-user mode) | [account.md](account.md) |
| `audit` (event log + retention sweep) | [audit.md](audit.md) |
| `backup` (export / restore) | [backup.md](backup.md) |
| `contact` (global contact directory with visibility and field masking) | [contact.md](contact.md) |
| `cron` (scheduler + action registry) | [cron.md](cron.md) |
| `file` (storage drivers + ref-counted GC) | [file.md](file.md) |
| `item` (base composition row + comments + attachments) | [item.md](item.md) |
| `policy` (Zanzibar tuples + access rules) | [policy.md](policy.md) |
| `search` (cross-module global search) | [search.md](search.md) |
| `settings` (per-key DB-backed settings + admin UI) | [settings.md](settings.md) |
| `share` (unified token-based sharing + public links) | [share.md](share.md) |
| `system` (health, version, build info) | [system.md](system.md) |

## Reference business modules (start here when adapting)

These are reference business modules that demonstrate composition on top of
`item` + `policy` + `file`. Drop them or replace their schema as your
project diverges from the template defaults.

| Module | Page |
|---|---|
| `document` (nested + share-inherited markdown documents) | [document.md](document.md) |
| `drive` (personal folders/files on the shared file module) | [drive.md](drive.md) |
| `issue` (issue tracker with comments + attachments; personal + project work orders) | [issue.md](issue.md) |
| `project` (engineering-project aggregate: members, files, work orders, procurement) | [project.md](project.md) |
| `procurement` (project procurement records, grant-gated) | [procurement.md](procurement.md) |
