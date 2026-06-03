#!/usr/bin/env bun
/**
 * Full-feature seed importer.
 *
 * Loads the curated static dataset under `scripts/seed/data/*.json` (with demo
 * files under `scripts/seed/assets/`) and writes it through the real
 * service-layer creators, covering every feature module.
 *
 * Reset semantics: this importer DELETES the target database file and recreates
 * it from migrations before importing, so every run starts from a clean,
 * reproducible state. The project is research-stage; data is meant to be reset.
 *
 * Schema growth: the dataset is plain JSON. When a column is added, add the
 * field to the relevant JSON object — the importer passes inputs straight to the
 * creators, so no generator logic changes.
 *
 * Usage:
 *   bun run seed
 */
/* eslint-disable no-console */
import type { AppDatabase } from "@/db";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { and, eq } from "drizzle-orm";
import { loadConfigStrict } from "@/config";
import { createDb } from "@/db";
import { addGroupMember, createGroup } from "@/modules/account/groups/groups.service";
import { users } from "@/modules/account/users/schema";
import { auditEvents } from "@/modules/audit/schema";
import * as contactService from "@/modules/contact/contact.service";
import { cronJobLogs, cronJobs } from "@/modules/cron/schema";
import { createDocument, pinDocument } from "@/modules/document/document.service";
import { createDriveFolder, createDriveTextFile, uploadDriveFile } from "@/modules/drive/drive.service";
import { addTeamMember, createTeamDirectory } from "@/modules/drive/drive.team-directory.service";
import { uploadEntryVersion } from "@/modules/drive/drive.version.service";
import { driveEntries } from "@/modules/drive/schema";
import { initFileModule, uploadAndReference } from "@/modules/file";
import { createIssue, resolveIssueItem } from "@/modules/issue/issue.service";
import { createComment } from "@/modules/item/comment.service";
import { items } from "@/modules/item/schema";
import { createTuple } from "@/modules/policy/policy.service";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { createCategory } from "@/modules/project/project.categories";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject, listMembers, setProjectCover } from "@/modules/project/project.service";
import { setSetting } from "@/modules/settings/settings.service";
import { createShare } from "@/modules/share/share.service";
import { createEquipment } from "@/modules/ship/ship.equipment.service";
import { createGlobalEquipmentCategory } from "@/modules/ship/ship.global-equipment-category.service";
import { bindProject, createShip, setShipCover } from "@/modules/ship/ship.service";
import { listShipEquipmentCategories } from "@/modules/ship/ship.ship-equipment-category.service";
import { createGlobalWorklist, createShipWorklist } from "@/modules/ship/ship.worklist.service";
import { ROOT_DIR } from "@/root";
import { nanoid, ulid } from "@/shared/lib/id";
// Side-effect imports: register the share adapters so `createShare` resolves
// document / drive_entry resource types (the app registers these at boot via
// the module index barrels; the seed importer pulls them in directly).
import "@/modules/document/document.share-adapter";
import "@/modules/drive/drive.share-adapter";

const SEED_DIR = import.meta.dir;
const DATA_DIR = resolve(SEED_DIR, "payload");
const COVERS_DIR = resolve(SEED_DIR, "assets/covers");
const ATTACH_DIR = resolve(SEED_DIR, "assets/attachments");

/** Base epoch for relative dates in the dataset. */
const EPOCH = Date.UTC(2026, 0, 1);
function dayOffset(days: number): string {
  return new Date(EPOCH + days * 86_400_000).toISOString().slice(0, 10);
}

async function readJson<T>(name: string): Promise<T> {
  return (await Bun.file(resolve(DATA_DIR, `${name}.json`)).json()) as T;
}

/** Load a demo file from assets as a `File` for upload-based creators. */
async function assetFile(dir: string, filename: string): Promise<File> {
  const path = resolve(dir, filename);
  const bun = Bun.file(path);
  if (!(await bun.exists()))
    throw new Error(`Seed asset missing: ${path}`);
  const buffer = await bun.arrayBuffer();
  const type = filename.endsWith(".pdf")
    ? "application/pdf"
    : filename.endsWith(".jpg") || filename.endsWith(".jpeg")
      ? "image/jpeg"
      : filename.endsWith(".png")
        ? "image/png"
        : "text/plain";
  return new File([buffer], filename, { type });
}

// ─── Dataset shapes (loose — JSON is the source of truth) ─────────────────
interface UserRec { key: string; username: string; name: string; email: string; role: "admin" | "user" }
interface GroupRec { key: string; name: string; description?: string; members: string[] }
interface ContactRec { key: string; kind: string; name: string; contactPerson?: string; email?: string; phone?: string; address?: string; visibility?: "private" | "public"; tags?: string[]; note?: string }
interface EquipmentRec { name: string; category?: string; manufacturer?: string; model?: string; serialNumber?: string; installedAt?: string; note?: string; location?: string; status?: "active" | "retired" }
interface ShipRec { key: string; name: string; model?: string; builder?: string; buildYear?: number; loa?: number; beam?: number; draft?: number; gt?: number | null; flagState?: string; registryPort?: string; status?: "active" | "archived"; tags?: string[]; cover?: string | null; imoNumber?: string; mmsi?: string; callSign?: string; ownerName?: string; equipment?: EquipmentRec[] }
interface MaintRec { key: string; name?: string; category?: string; checklist?: string; precautions?: string; ship?: string; fromGlobal?: string }
interface ProjectRec { key: string; name: string; description?: string; creator: string; tags?: string[]; cover?: string | null; bindShip?: string | null; members?: { user: string; role: string }[]; categories?: string[] }
interface IssueTemplate { key: string; title: string; status: string; priority: string; tags?: string[]; description?: string; assign?: boolean; dueOffsetDays?: number | null; attachment?: string | null; comments?: { text: string; internal?: boolean }[] }
interface ProcTemplate { key: string; itemName: string; status: string; supplier?: string; category?: string; quantity?: number; amount?: number; currency?: string; priority?: string; description?: string; dueOffsetDays?: number | null; attachment?: string | null }
interface DocRec { key: string; title: string; creator: string; tags?: string[]; content?: string; parent?: string | null; pinnedBy?: string[]; attachment?: string | null; shares?: { kind: "link" | "grant"; with?: string; permission?: "viewer" | "editor" }[] }
interface DriveRec { teamDirectories: { key: string; name: string; description?: string; createdBy: string; members?: { user: string; role: string }[] }[]; entries: { key: string; ownerType: string; owner: string; createdBy: string; type: "folder" | "file" | "text"; name: string; parent?: string | null; asset?: string; content?: string; versions?: string[] }[]; shares?: { entry: string; by: string; type: "direct" | "public_link"; permission: "view" | "download" | "edit"; with?: string }[] }
interface CronRec { jobs: { key: string; name: string; cron: string; taskType: string; taskConfig: Record<string, unknown>; enabled?: boolean; maxConsecutiveFailures?: number; logs?: { status: "running" | "success" | "failed"; durationMs?: number; result?: string; error?: string }[] }[] }
interface SettingRec { key: string; value: string }
interface AuditRec { action: string; resourceType: string; resourceName: string; result: "success" | "failure"; actor: string; detail?: Record<string, unknown> }

type Config = Awaited<ReturnType<typeof loadConfigStrict>>;

// key → produced id maps
const userId = new Map<string, string>();
const userName = new Map<string, string>();
const contactId = new Map<string, string>();
const shipInternalId = new Map<string, string>();
const shipShortId = new Map<string, string>();
const globalWorklistId = new Map<string, string>();
interface ProjectInfo { id: string; shortId: string; creatorUserId: string; memberRoleId: string; members: { memberId: string; userId: string }[]; categoryIds: Map<string, string> }
const projectInfo = new Map<string, ProjectInfo>();

const ADMIN_KEY = "admin";

// Starter bilingual equipment-category template. Seeded into the GLOBAL
// template (`global_equipment_categories`); each new ship gets its own copy on
// create. The `slug` is stored as the row `code` and matches the free-text
// `category` field carried by the equipment records in ships.json, so each
// seeded item can resolve to its ship's own copied category id.
const SHIP_EQUIPMENT_CATEGORIES: { slug: string; nameZh: string; nameEn: string }[] = [
  { slug: "propulsion", nameZh: "推进系统", nameEn: "Propulsion" },
  { slug: "navigation", nameZh: "导航设备", nameEn: "Navigation" },
  { slug: "electrical", nameZh: "电气设备", nameEn: "Electrical" },
  { slug: "deck", nameZh: "甲板设备", nameEn: "Deck" },
  { slug: "safety", nameZh: "安全设备", nameEn: "Safety" },
  { slug: "hvac", nameZh: "空调通风", nameEn: "HVAC" },
];

function uId(key: string): string {
  const id = userId.get(key);
  if (!id)
    throw new Error(`Unknown user key: ${key}`);
  return id;
}

// ─── Importers ────────────────────────────────────────────────────────────

async function importUsers(db: AppDatabase): Promise<void> {
  const recs = await readJson<UserRec[]>("users");
  for (const u of recs) {
    const id = `seed-user-${u.key}`;
    await db.insert(users).values({
      id,
      oauthSub: `seed|${u.username}`,
      username: u.username,
      name: u.name,
      email: u.email,
      role: u.role,
    }).run();
    userId.set(u.key, id);
    userName.set(u.key, u.name);
  }
}

async function importGroups(db: AppDatabase): Promise<void> {
  const recs = await readJson<GroupRec[]>("groups");
  for (const g of recs) {
    const group = await createGroup(db, { name: g.name, description: g.description });
    for (const memberKey of g.members)
      await addGroupMember(db, group.id, uId(memberKey));
  }
}

async function importContacts(db: AppDatabase): Promise<void> {
  const recs = await readJson<ContactRec[]>("contacts");
  const actor = { id: uId(ADMIN_KEY), role: "admin" };
  for (const c of recs) {
    const contact = await contactService.create(db, actor, {
      name: c.name,
      contactPerson: c.contactPerson ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      address: c.address ?? null,
      note: c.note ?? null,
      visibility: c.visibility ?? "private",
      tags: c.tags ?? [],
    });
    contactId.set(c.key, contact.id);
  }
}

async function importEquipmentCategories(db: AppDatabase): Promise<number> {
  for (const cat of SHIP_EQUIPMENT_CATEGORIES)
    await createGlobalEquipmentCategory(db, { nameZh: cat.nameZh, nameEn: cat.nameEn, code: cat.slug });
  return SHIP_EQUIPMENT_CATEGORIES.length;
}

async function importShips(db: AppDatabase, config: Config): Promise<number> {
  const recs = await readJson<ShipRec[]>("ships");
  let equipment = 0;
  for (const s of recs) {
    const ship = await createShip(db, {
      name: s.name,
      creatorId: uId(ADMIN_KEY),
      status: s.status ?? "active",
      tags: s.tags ?? [],
      model: s.model ?? null,
      builder: s.builder ?? null,
      buildYear: s.buildYear ?? null,
      lengthOverall: s.loa ?? null,
      beam: s.beam ?? null,
      draft: s.draft ?? null,
      grossTonnage: s.gt ?? null,
      imoNumber: s.imoNumber ?? null,
      mmsi: s.mmsi ?? null,
      callSign: s.callSign ?? null,
      flagState: s.flagState ?? null,
      registryPort: s.registryPort ?? null,
      ownerName: s.ownerName ?? null,
      description: s.model ? `${s.builder ?? ""} ${s.model} — ${s.loa ?? "?"} m.`.trim() : null,
    });
    shipInternalId.set(s.key, ship.id);
    shipShortId.set(s.key, ship.shortId);

    // createShip copied the global template into this ship's own categories;
    // resolve each equipment's category against that per-ship set (keyed by the
    // `code` slug carried over from the template).
    const perShipCategoryIdByCode = new Map<string, string>();
    for (const cat of await listShipEquipmentCategories(db, ship.id)) {
      if (cat.code)
        perShipCategoryIdByCode.set(cat.code, cat.id);
    }

    for (const e of s.equipment ?? []) {
      await createEquipment(db, ship.id, {
        name: e.name,
        categoryId: (e.category ? perShipCategoryIdByCode.get(e.category) : undefined) ?? null,
        manufacturer: e.manufacturer ?? null,
        model: e.model ?? null,
        serialNumber: e.serialNumber ?? null,
        installedAt: e.installedAt ?? null,
        note: e.note ?? null,
        location: e.location ?? null,
        status: e.status ?? "active",
      });
      equipment++;
    }

    if (s.cover) {
      const file = await assetFile(COVERS_DIR, s.cover);
      await setShipCover(db, config, ship.id, file, uId(ADMIN_KEY));
    }
  }
  return equipment;
}

async function importWorklists(db: AppDatabase): Promise<number> {
  const recs = await readJson<{ global: MaintRec[]; ship: MaintRec[] }>("worklists");
  let count = 0;
  for (const t of recs.global) {
    const wl = await createGlobalWorklist(db, {
      name: t.name ?? t.key,
      category: t.category,
      checklist: t.checklist,
      precautions: t.precautions,
    });
    globalWorklistId.set(t.key, wl.id);
    count++;
  }
  for (const t of recs.ship) {
    const internalId = shipInternalId.get(t.ship!);
    if (!internalId)
      throw new Error(`Worklist ${t.key} references unknown ship ${t.ship}`);
    await createShipWorklist(db, internalId, {
      name: t.name,
      category: t.category,
      checklist: t.checklist,
      precautions: t.precautions,
      fromGlobalId: t.fromGlobal ? globalWorklistId.get(t.fromGlobal) : undefined,
    });
    count++;
  }
  return count;
}

async function importProjects(db: AppDatabase, config: Config): Promise<void> {
  const recs = await readJson<ProjectRec[]>("projects");
  for (const p of recs) {
    const creatorUserId = uId(p.creator);
    const project = await createProject(db, {
      name: p.name,
      creatorId: creatorUserId,
      description: p.description ?? null,
      tags: p.tags ?? [],
    });

    // The creator is auto-added with the Owner (system) role; the "Reader"
    // preset is used for added members (read-only access by default).
    const roles = await listRoles(db, project.id);
    const memberRole = roles.find(r => r.name === "Reader" && r.isSystem === 0);
    if (!memberRole)
      throw new Error(`No Reader role on project ${p.key}`);

    const members: { memberId: string; userId: string }[] = [];
    for (const m of p.members ?? []) {
      const member = await addMember(db, project.id, { roleId: memberRole.id, userId: uId(m.user) });
      members.push({ memberId: member.id, userId: uId(m.user) });
    }

    const categoryIds = new Map<string, string>();
    for (const catName of p.categories ?? []) {
      const cat = await createCategory(db, project.id, { name: catName, code: catName.slice(0, 4).toUpperCase() });
      categoryIds.set(catName, cat.id);
    }

    if (p.bindShip) {
      const internalId = shipInternalId.get(p.bindShip);
      if (internalId)
        await bindProject(db, internalId, project.shortId);
    }

    if (p.cover) {
      const file = await assetFile(COVERS_DIR, p.cover);
      await setProjectCover(db, config, project.id, file, creatorUserId);
    }

    projectInfo.set(p.key, {
      id: project.id,
      shortId: project.shortId,
      creatorUserId,
      memberRoleId: memberRole.id,
      members,
      categoryIds,
    });
  }
}

async function importIssues(db: AppDatabase, config: Config): Promise<{ issues: number; comments: number; attachments: number }> {
  const { templates } = await readJson<{ templates: IssueTemplate[] }>("issue-templates");
  let issues = 0;
  let comments = 0;
  let attachments = 0;

  for (const proj of projectInfo.values()) {
    for (const t of templates) {
      const assignedMember = t.assign && proj.members.length > 0 ? proj.members[issues % proj.members.length]! : null;
      const dueDate = t.dueOffsetDays != null ? dayOffset(t.dueOffsetDays) : undefined;

      const issue = await createIssue(db, {
        title: t.title,
        description: t.description,
        projectId: proj.id,
        creatorId: proj.creatorUserId,
        status: t.status as never,
        priority: t.priority as never,
        tags: t.tags ?? [],
        ...(assignedMember ? { assigneeMemberId: assignedMember.memberId } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      issues++;

      const item = await resolveIssueItem(db, issue.id);
      if (!item)
        continue;

      // Attachment on the issue (owner_type='item_attachment', owner=item.id).
      if (t.attachment) {
        const file = await assetFile(ATTACH_DIR, t.attachment);
        await uploadAndReference(db, config, {
          file,
          ownerType: "item_attachment",
          ownerId: item.id,
          uploadedBy: proj.creatorUserId,
          allowAnyType: true,
        });
        attachments++;
      }

      // Comments, authored by rotating members (favouring the assignee).
      const authors = [
        ...(assignedMember ? [assignedMember.userId] : []),
        proj.creatorUserId,
        ...proj.members.map(m => m.userId),
      ];
      let ci = 0;
      for (const note of t.comments ?? []) {
        await createComment(db, {
          itemId: item.id,
          authorId: authors[ci % authors.length]!,
          content: note.text,
          ...(note.internal ? { isInternal: true } : {}),
        });
        comments++;
        ci++;
      }
    }
  }
  return { issues, comments, attachments };
}

async function importProcurements(db: AppDatabase, config: Config): Promise<{ procurements: number; attachments: number }> {
  const { templates } = await readJson<{ templates: ProcTemplate[] }>("procurement-templates");
  let procurements = 0;
  let attachments = 0;

  for (const proj of projectInfo.values()) {
    const assignable = (await listMembers(db, proj.id)).filter(m => m.userId);
    let idx = 0;
    for (const t of templates) {
      const categoryId = (t.category && proj.categoryIds.get(t.category))
        ?? (proj.categoryIds.size > 0 ? [...proj.categoryIds.values()][idx % proj.categoryIds.size] : undefined);
      const supplierId = t.supplier ? contactId.get(t.supplier) : undefined;
      const assignee = assignable.length > 0 && idx % 2 === 0 ? assignable[idx % assignable.length]! : null;
      const dueDate = t.dueOffsetDays != null ? dayOffset(t.dueOffsetDays) : undefined;

      const proc = await createProcurement(db, {
        projectId: proj.id,
        itemName: t.itemName,
        creatorId: proj.creatorUserId,
        status: t.status as never,
        priority: (t.priority ?? "medium") as never,
        description: t.description,
        quantity: t.quantity ?? null,
        amount: t.amount ?? null,
        currency: t.currency ?? "USD",
        ...(supplierId ? { supplierId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(assignee ? { assigneeMemberId: assignee.id } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      procurements++;

      if (t.attachment) {
        const file = await assetFile(ATTACH_DIR, t.attachment);
        await uploadAndReference(db, config, {
          file,
          ownerType: "item_attachment",
          ownerId: proc.id,
          uploadedBy: proj.creatorUserId,
          allowAnyType: true,
        });
        attachments++;
      }
      idx++;
    }
  }
  return { procurements, attachments };
}

async function importDocuments(db: AppDatabase, config: Config): Promise<{ documents: number; pins: number; shares: number; attachments: number }> {
  const recs = await readJson<DocRec[]>("documents");
  const docShortId = new Map<string, string>();
  let pins = 0;
  let shares = 0;
  let attachments = 0;

  for (const d of recs) {
    const doc = await createDocument(db, {
      title: d.title,
      content: d.content,
      tags: d.tags ?? [],
      creatorId: uId(d.creator),
      ...(d.parent ? { parentId: docShortId.get(d.parent) } : {}),
    });
    docShortId.set(d.key, doc.id);

    for (const userKey of d.pinnedBy ?? []) {
      await pinDocument(db, uId(userKey), doc.id);
      pins++;
    }

    if (d.attachment) {
      // Resolve the document's internal item id for the attachment owner.
      const item = await resolveDocItemId(db, doc.id);
      if (item) {
        const file = await assetFile(ATTACH_DIR, d.attachment);
        await uploadAndReference(db, config, {
          file,
          ownerType: "item_attachment",
          ownerId: item,
          uploadedBy: uId(d.creator),
          allowAnyType: true,
        });
        attachments++;
      }
    }

    // Document shares come in two flavours:
    //  - "link": an anonymous public link (the document share adapter only
    //    supports public_link + view), via the share module.
    //  - "grant": a direct collaborator (viewer/editor) — modelled as a policy
    //    tuple on the document's item, the same way the app's direct-share path
    //    does (collaborator grants are tuples, not share rows).
    const itemId = await resolveDocItemId(db, doc.id);
    for (const s of d.shares ?? []) {
      if (s.kind === "link") {
        await createShare(db, {
          resourceType: "document",
          resourceId: doc.id,
          createdBy: uId(d.creator),
          shareType: "public_link",
          permission: "view",
        });
        shares++;
      }
      else if (s.kind === "grant" && itemId && s.with) {
        await createTuple(db, {
          namespace: "item",
          objectId: itemId,
          relation: s.permission === "editor" ? "editor" : "viewer",
          subjectNamespace: "user",
          subjectId: uId(s.with),
        }, uId(d.creator));
        shares++;
      }
    }
  }
  return { documents: recs.length, pins, shares, attachments };
}

/** Resolve a document's internal item id from its short_id. */
async function resolveDocItemId(db: AppDatabase, shortId: string): Promise<string | undefined> {
  const row = await db.select({ id: items.id }).from(items).where(and(eq(items.shortId, shortId), eq(items.type, "document"))).get();
  return row?.id;
}

async function importDrive(db: AppDatabase, config: Config): Promise<{ directories: number; entries: number; versions: number; shares: number }> {
  const data = await readJson<DriveRec>("drive");
  const tdId = new Map<string, string>();
  const entryId = new Map<string, string>();
  let versions = 0;

  for (const td of data.teamDirectories) {
    const dir = await createTeamDirectory(db, {
      name: td.name,
      description: td.description,
      createdBy: uId(td.createdBy),
    });
    tdId.set(td.key, dir.id);
    for (const m of td.members ?? [])
      await addTeamMember(db, dir.id, uId(td.createdBy), { userId: uId(m.user), role: m.role as never });
  }

  for (const e of data.entries) {
    const ownerId = e.ownerType === "team_directory" ? tdId.get(e.owner)! : uId(e.owner);
    const parentEntryId = e.parent ? entryId.get(e.parent) ?? null : null;
    const base = { ownerType: e.ownerType as never, ownerId, createdBy: uId(e.createdBy), parentEntryId };

    let view;
    if (e.type === "folder") {
      view = await createDriveFolder(db, { ...base, name: e.name });
    }
    else if (e.type === "text") {
      view = await createDriveTextFile(db, config, { ...base, name: e.name, content: e.content ?? "" });
    }
    else {
      const file = await assetFile(ATTACH_DIR, e.asset!);
      view = await uploadDriveFile(db, config, { ...base, file: new File([await file.arrayBuffer()], e.name, { type: file.type }) });
    }
    entryId.set(e.key, view.id);

    // Extra versions for file entries.
    for (const versionAsset of e.versions ?? []) {
      const entryRow = await db.select().from(driveEntries).where(eq(driveEntries.id, view.id)).get();
      if (entryRow) {
        const vfile = await assetFile(ATTACH_DIR, versionAsset);
        await uploadEntryVersion(db, config, { entry: entryRow, file: new File([await vfile.arrayBuffer()], e.name, { type: vfile.type }), uploadedBy: uId(e.createdBy) });
        versions++;
      }
    }
  }
  // Drive shares exercise the richer share variants (drive_entry supports
  // direct + public_link with view/download/edit).
  let shares = 0;
  for (const s of data.shares ?? []) {
    const resourceId = entryId.get(s.entry);
    if (!resourceId)
      continue;
    await createShare(db, {
      resourceType: "drive_entry",
      resourceId,
      createdBy: uId(s.by),
      shareType: s.type,
      permission: s.permission,
      ...(s.with ? { sharedWithUserId: uId(s.with) } : {}),
    });
    shares++;
  }

  return { directories: data.teamDirectories.length, entries: data.entries.length, versions, shares };
}

async function importCron(db: AppDatabase): Promise<{ jobs: number; logs: number }> {
  const data = await readJson<CronRec>("cron");
  let logs = 0;
  for (const j of data.jobs) {
    const id = nanoid();
    await db.insert(cronJobs).values({
      id,
      name: j.name,
      cron: j.cron,
      taskType: j.taskType,
      taskConfig: JSON.stringify(j.taskConfig),
      enabled: j.enabled ?? true,
      maxConsecutiveFailures: j.maxConsecutiveFailures ?? 3,
    }).run();

    let offset = 0;
    for (const log of j.logs ?? []) {
      const startedAt = new Date(EPOCH + (offset += 86_400_000)).toISOString();
      const finishedAt = log.durationMs != null ? new Date(Date.parse(startedAt) + log.durationMs).toISOString() : null;
      await db.insert(cronJobLogs).values({
        id: ulid(),
        jobId: id,
        startedAt,
        finishedAt,
        status: log.status,
        durationMs: log.durationMs ?? null,
        result: log.result ?? null,
        error: log.error ?? null,
      }).run();
      logs++;
    }
  }
  return { jobs: data.jobs.length, logs };
}

async function importAudit(db: AppDatabase): Promise<number> {
  // A small spread of audit events referencing seeded resources.
  const recs: AuditRec[] = [
    { action: "ship.created", resourceType: "ship", resourceName: "Aurora", result: "success", actor: "admin" },
    { action: "project.created", resourceType: "project", resourceName: "Aurora Dry-Dock Refit 2026", result: "success", actor: "pm-mercer" },
    { action: "issue.updated", resourceType: "issue", resourceName: "Replace bridge navigation radar", result: "success", actor: "eng-lin" },
    { action: "procurement.created", resourceType: "procurement", resourceName: "NR-900X navigation radar unit", result: "success", actor: "pm-mercer" },
    { action: "document.shared", resourceType: "document", resourceName: "Fleet Operations Handbook", result: "success", actor: "admin" },
    { action: "auth.login", resourceType: "session", resourceName: "seed-admin", result: "success", actor: "admin" },
    { action: "auth.login", resourceType: "session", resourceName: "unknown", result: "failure", actor: "admin" },
    { action: "share.created", resourceType: "share", resourceName: "Crew Onboarding Guide", result: "success", actor: "ops-murphy" },
  ];
  let offset = 0;
  for (const a of recs) {
    await db.insert(auditEvents).values({
      id: ulid(),
      actorId: uId(a.actor),
      actorName: userName.get(a.actor) ?? a.actor,
      action: a.action,
      resourceType: a.resourceType,
      resourceId: nanoid(),
      resourceName: a.resourceName,
      detail: a.detail ? JSON.stringify(a.detail) : null,
      ip: "127.0.0.1",
      userAgent: "seed-script",
      result: a.result,
      createdAt: new Date(EPOCH + (offset += 3_600_000)).toISOString(),
    }).run();
  }
  return recs.length;
}

async function importSettings(db: AppDatabase): Promise<number> {
  const recs = await readJson<SettingRec[]>("settings");
  for (const s of recs)
    await setSetting(db, s.key, s.value, { updatedBy: uId(ADMIN_KEY) });
  return recs.length;
}

async function main(): Promise<void> {
  const dbPath = resolve(ROOT_DIR, process.env.DB_PATH ?? "data/db/app.db");

  // Reset: delete the DB file (and WAL/SHM sidecars), then recreate from
  // migrations. Guarantees a clean, reproducible state every run.
  console.log(`Resetting database at ${dbPath}`);
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${dbPath}${suffix}`;
    if (existsSync(f))
      rmSync(f, { force: true });
  }

  const config = await loadConfigStrict(() => {});
  await initFileModule(config);
  const db = await createDb(dbPath);

  try {
    await importUsers(db);
    await importGroups(db);
    await importContacts(db);
    const equipmentCategories = await importEquipmentCategories(db);
    const equipment = await importShips(db, config);
    const worklistCount = await importWorklists(db);
    await importProjects(db, config);
    const issues = await importIssues(db, config);
    const procurements = await importProcurements(db, config);
    const documents = await importDocuments(db, config);
    const drive = await importDrive(db, config);
    const cron = await importCron(db);
    const audits = await importAudit(db);
    const settingsCount = await importSettings(db);

    console.log("Seed complete:");
    console.log(`  users:        ${userId.size}`);
    console.log(`  groups:       (with members)`);
    console.log(`  contacts:     ${contactId.size}`);
    console.log(`  equip cats:   ${equipmentCategories} (bilingual)`);
    console.log(`  ships:        ${shipInternalId.size} (+ base projects, ${equipment} equipment)`);
    console.log(`  worklists:    ${worklistCount}`);
    console.log(`  projects:     ${projectInfo.size} standalone (+ ship base projects)`);
    console.log(`  issues:       ${issues.issues} (${issues.comments} comments, ${issues.attachments} attachments)`);
    console.log(`  procurements: ${procurements.procurements} (${procurements.attachments} attachments)`);
    console.log(`  documents:    ${documents.documents} (${documents.pins} pins, ${documents.shares} shares, ${documents.attachments} attachments)`);
    console.log(`  drive:        ${drive.directories} team dirs, ${drive.entries} entries, ${drive.versions} extra versions, ${drive.shares} shares`);
    console.log(`  cron:         ${cron.jobs} jobs, ${cron.logs} logs`);
    console.log(`  audit:        ${audits} events`);
    console.log(`  settings:     ${settingsCount}`);
    console.log(`\nAdmin demo account: username "seed-admin" (oauth_sub "seed|seed-admin", admin@seed.local).`);
  }
  finally {
    db.close();
  }
}

await main();
