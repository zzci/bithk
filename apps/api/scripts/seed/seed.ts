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
import { createVirtualUser } from "@/modules/account/users/users.service";
import { auditEvents } from "@/modules/audit/schema";
import { createContactCategory } from "@/modules/contact/contact-category.service";
import * as contactService from "@/modules/contact/contact.service";
import { cronJobLogs, cronJobs } from "@/modules/cron/schema";
import { createDocument, pinDocument } from "@/modules/document/document.service";
import { createDriveFolder, createDriveTextFile, uploadDriveFile } from "@/modules/drive/drive.service";
import { addTeamMember, createTeamDirectory } from "@/modules/drive/drive.team-directory.service";
import { uploadEntryVersion } from "@/modules/drive/drive.version.service";
import { driveEntries } from "@/modules/drive/schema";
import { initFileModule, uploadAndReference } from "@/modules/file";
import { createApproval, decideApproval } from "@/modules/hr/hr.approvals.service";
import { createPayrollRecord, updatePayrollRecord } from "@/modules/hr/hr.payroll.service";
import { createColleague } from "@/modules/hr/hr.service";
import { createIssue, resolveIssueItem } from "@/modules/issue/issue.service";
import { addReference } from "@/modules/issue/references.service";
import { createComment } from "@/modules/item/comment.service";
import { items } from "@/modules/item/schema";
import { createTuple } from "@/modules/policy/policy.service";
import { listCategories } from "@/modules/procurement/procurement.categories";
import { createGlobalCategory } from "@/modules/procurement/procurement.global-categories";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject, listMembers, setProjectCover } from "@/modules/project/project.service";
import { setSetting } from "@/modules/settings/settings.service";
import { createShare } from "@/modules/share/share.service";
import { createEquipment } from "@/modules/ship/ship.equipment.service";
import { createGlobalEquipmentCategory } from "@/modules/ship/ship.global-equipment-category.service";
import { createGlobalEquipmentManufacturer } from "@/modules/ship/ship.global-equipment-manufacturer.service";
import { listProjectEquipmentCategories } from "@/modules/ship/ship.ship-equipment-category.service";
import { createGlobalWorklist, createProjectWorklist } from "@/modules/ship/ship.worklist.service";
import { ROOT_DIR } from "@/root";
import { nanoid, ulid } from "@/shared/lib/id";
import { assertMountIntegrity } from "./seed.integrity";
// Side-effect imports. The four module barrels register the project sections
// (PLAN-108 §3) whose `provision` hooks run inside `createProject` — without
// them a new project would get bare mount rows and no ship profile, no copied
// categories. `document.share-adapter` registers the share resource type
// `createShare` resolves; the drive one ships with the drive barrel.
import "@/modules/drive";
import "@/modules/issue";
import "@/modules/procurement";
import "@/modules/ship";
import "@/modules/document/document.share-adapter";

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
interface UserRec { key: string; username: string; name: string; email: string; role: "admin" | "user"; oauthSub?: string }
interface GroupRec { key: string; name: string; description?: string; modules?: string[]; members: string[] }
interface ContactRec { key: string; kind: "individual" | "organization"; name: string; phone?: string; email?: string; website?: string; position?: string; org?: string; taxId?: string; address?: string; category?: string; status?: "active" | "inactive"; confidential?: boolean; visibility?: "private" | "public"; tags?: string[]; note?: string; attributes?: Record<string, string> }
interface EquipmentRec { name: string; category?: string; manufacturer?: string; model?: string; serialNumber?: string; installedAt?: string; note?: string; location?: string; status?: "active" | "retired" }
// A ship is a PROJECT created with the `ship` preset: the project-level
// fields sit at the top of the record and the maritime particulars go through
// verbatim as the `ship-profile` slice of `sectionData` (the field names match
// `shipProfileSectionDataSchema`, so no mapping layer is needed).
interface ShipProfileRec { hullNumber: string; shipStatus?: "under_construction" | "active" | "underway" | "in_maintenance" | "laid_up" | "retired"; model?: string | null; builder?: string | null; buildYear?: number | null; lengthOverall?: number | null; beam?: number | null; draft?: number | null; airDraft?: number | null; grossTonnage?: number | null; imoNumber?: string | null; mmsi?: string | null; callSign?: string | null; flagState?: string | null; registryPort?: string | null; ownerName?: string | null }
interface ShipRec { key: string; name: string; code?: string; description?: string | null; tags?: string[]; cover?: string | null; profile: ShipProfileRec; equipment?: EquipmentRec[] }
interface MaintRec { key: string; name?: string; category?: string; checklist?: string; precautions?: string; project?: string; fromGlobal?: string }
// `parent` is a ship key: the old "bound project" link is now a sub-project,
// so the refit/survey project hangs under its vessel's project.
interface ProjectRec { key: string; name: string; description?: string; creator: string; tags?: string[]; cover?: string | null; parent?: string | null; members?: { user?: string; username?: string; name?: string; title?: string; role: string }[] }
interface IssueTemplate { key: string; title: string; status: string; priority: string; tags?: string[]; description?: string; assign?: boolean; dueOffsetDays?: number | null; attachment?: string | null; comments?: { text: string; internal?: boolean }[] }
interface ProcTemplate { key: string; itemName: string; status: string; supplier?: string; category?: string; tags?: string[]; quantity?: number; amount?: number; currency?: string; priority?: string; description?: string; dueOffsetDays?: number | null; attachment?: string | null }
interface ContactCategoryRec { key: string; name: string; code?: string; description?: string }
interface GlobalProcCategoryRec { name: string; code?: string; description?: string }
interface DocRec { key: string; title: string; creator: string; tags?: string[]; content?: string; parent?: string | null; pinnedBy?: string[]; attachment?: string | null; shares?: { kind: "link" | "grant"; with?: string; permission?: "viewer" | "editor" }[] }
interface DriveRec { teamDirectories: { key: string; name: string; description?: string; createdBy: string; members?: { user: string; role: string }[] }[]; entries: { key: string; ownerType: string; owner: string; createdBy: string; type: "folder" | "file" | "text"; name: string; parent?: string | null; asset?: string; content?: string; versions?: string[] }[]; shares?: { entry: string; by: string; type: "direct" | "public_link"; permission: "view" | "download" | "edit"; with?: string }[] }
interface CronRec { jobs: { key: string; name: string; cron: string; taskType: string; taskConfig: Record<string, unknown>; enabled?: boolean; maxConsecutiveFailures?: number; logs?: { status: "running" | "success" | "failed"; durationMs?: number; result?: string; error?: string }[] }[] }
interface SettingRec { key: string; value: string }
interface AuditRec { action: string; resourceType: string; resourceName: string; result: "success" | "failure"; actor: string; detail?: Record<string, unknown> }
interface HrColleagueRec { key: string; user: string; code?: string; title?: string; department?: string; notes?: string; birthday?: string; hireDate?: string; probationEndDate?: string; contractEndDate?: string; gender?: "male" | "female" | "other" | "undisclosed"; employmentType?: "full_time" | "part_time" | "contract" | "intern"; nationality?: string; personalPhone?: string; personalEmail?: string; address?: string; workLocation?: string; paymentInfo?: { label: string; value: string }[]; emergencyContacts?: { name: string; relation: string; phone: string; email: string; address: string }[] }
interface HrApprovalRec { colleague: string; type: "leave" | "overtime" | "business_trip" | "other"; title: string; reason?: string; decision: "pending" | "approved" | "rejected"; decider?: string; note?: string }
interface HrPayrollRec { colleague: string; period: string; baseSalary: number; bonus?: number; deduction?: number; currency: string; status: "pending" | "paid"; notes?: string }

type Config = Awaited<ReturnType<typeof loadConfigStrict>>;

// key → produced id maps
const userId = new Map<string, string>();
const userName = new Map<string, string>();
const contactCategoryId = new Map<string, string>();
const contactId = new Map<string, string>();
// Ship-project ids, keyed by the ships.json `key`. Both are needed: the
// internal ULID scopes equipment / worklists, the short id is what a
// sub-project passes as its `parentId`.
const shipProjectId = new Map<string, string>();
const shipProjectShortId = new Map<string, string>();
const globalWorklistId = new Map<string, string>();
// Seeded worklist {id, name} pairs (global + per-project) — valid
// `issue_references` refIds for `refType:"worklist"`. Issue item ids collected
// during import so a later pass can attach worklist references to them.
const seededWorklistRefs: { id: string; name: string }[] = [];
const seededIssueItemIds: string[] = [];
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
      // A real OIDC sub (e.g. the bundled dex `admin@bit.hk`) lets that account
      // own seeded data: on login provisionUser matches by oauth_sub and keeps
      // the seeded role/ownership instead of creating a fresh empty user.
      oauthSub: u.oauthSub ?? `seed|${u.username}`,
      id,
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
    const group = await createGroup(db, { name: g.name, description: g.description, modules: g.modules });
    for (const memberKey of g.members)
      await addGroupMember(db, group.id, uId(memberKey));
  }
}

async function importContactCategories(db: AppDatabase): Promise<number> {
  const recs = await readJson<ContactCategoryRec[]>("contact-categories");
  for (const c of recs) {
    const row = await createContactCategory(db, { name: c.name, code: c.code, description: c.description });
    contactCategoryId.set(c.key, row.id);
  }
  return recs.length;
}

async function importContacts(db: AppDatabase): Promise<void> {
  const recs = await readJson<ContactRec[]>("contacts");
  const actor = { id: uId(ADMIN_KEY), role: "admin" };
  // Organizations first so individuals can link to them by key (sort is stable,
  // so the within-kind order from the payload is preserved).
  const ordered = [...recs].sort(
    (a, b) => (a.kind === "organization" ? 0 : 1) - (b.kind === "organization" ? 0 : 1),
  );
  for (const c of ordered) {
    // `position` + the org link are individual-only; everything else (phone,
    // email, website, taxId, address, note) is shared by both kinds.
    const kindFields = c.kind === "individual"
      ? {
          position: c.position ?? null,
          organizationId: c.org ? contactId.get(c.org) ?? null : null,
        }
      : {};
    const contact = await contactService.create(db, actor, {
      kind: c.kind,
      name: c.name,
      phone: c.phone ?? null,
      email: c.email ?? null,
      website: c.website ?? null,
      taxId: c.taxId ?? null,
      address: c.address ?? null,
      note: c.note ?? null,
      categoryId: c.category ? contactCategoryId.get(c.category) ?? null : null,
      status: c.status ?? "active",
      confidential: c.confidential ?? false,
      visibility: c.visibility ?? "private",
      tags: c.tags ?? [],
      attributes: c.attributes ?? null,
      ...kindFields,
    });
    contactId.set(c.key, contact.id);
  }
}

async function importGlobalProcurementCategories(db: AppDatabase): Promise<number> {
  const recs = await readJson<GlobalProcCategoryRec[]>("global-procurement-categories");
  for (const c of recs)
    await createGlobalCategory(db, { name: c.name, code: c.code, description: c.description });
  return recs.length;
}

async function importEquipmentCategories(db: AppDatabase): Promise<number> {
  for (const cat of SHIP_EQUIPMENT_CATEGORIES)
    await createGlobalEquipmentCategory(db, { nameZh: cat.nameZh, nameEn: cat.nameEn, code: cat.slug });
  return SHIP_EQUIPMENT_CATEGORIES.length;
}

/**
 * Global equipment-manufacturer vocabulary, derived from the fixtures: one
 * `equipment_manufacturers` row per DISTINCT manufacturer string across every
 * ship's equipment. Shared globally (no per-project copy), and seeded before
 * any project so the equipment importer can resolve free text to a row id.
 */
async function importEquipmentManufacturers(db: AppDatabase): Promise<Map<string, string>> {
  const recs = await readJson<ShipRec[]>("ships");
  const manufacturerIdByName = new Map<string, string>();
  for (const s of recs) {
    for (const e of s.equipment ?? []) {
      if (e.manufacturer && !manufacturerIdByName.has(e.manufacturer)) {
        const row = await createGlobalEquipmentManufacturer(db, { name: e.manufacturer });
        manufacturerIdByName.set(e.manufacturer, row.id);
      }
    }
  }
  return manufacturerIdByName;
}

/**
 * Ships, imported through the NORMAL project create path: a ship is a project
 * on the `ship` preset, and the maritime particulars ride along as the
 * `ship-profile` slice of `sectionData`. Nothing here writes `project_sections`,
 * `ship_profiles` or `ship_equipment_categories` — `createProject` mounts the
 * six sections and runs their provision hooks in one transaction, so the seed
 * doubles as a provisioning test.
 */
async function importShipProjects(
  db: AppDatabase,
  config: Config,
  manufacturerIdByName: ReadonlyMap<string, string>,
): Promise<{ ships: number; equipment: number }> {
  const recs = await readJson<ShipRec[]>("ships");

  let equipment = 0;
  for (const s of recs) {
    const project = await createProject(db, {
      name: s.name,
      code: s.code,
      creatorId: uId(ADMIN_KEY),
      description: s.description ?? null,
      tags: s.tags ?? [],
      preset: "ship",
      // Handed through untyped; the ship module validates the slice.
      sectionData: { "ship-profile": s.profile },
    });
    shipProjectId.set(s.key, project.id);
    shipProjectShortId.set(s.key, project.shortId);

    // The `equipment` section's provision hook copied the global template into
    // this project's own categories; resolve each equipment record's category
    // against that copy (keyed by the `code` slug carried over from the
    // template). An empty copy means the global template was seeded after the
    // project — the ordering bug this check exists to catch.
    const categoryIdByCode = new Map<string, string>();
    for (const cat of await listProjectEquipmentCategories(db, project.id)) {
      if (cat.code)
        categoryIdByCode.set(cat.code, cat.id);
    }
    if (categoryIdByCode.size === 0)
      throw new Error(`Ship project ${s.key} copied no equipment categories; seed the global template before creating projects`);

    for (const e of s.equipment ?? []) {
      await createEquipment(db, project.id, {
        name: e.name,
        categoryId: (e.category ? categoryIdByCode.get(e.category) : undefined) ?? null,
        manufacturerId: (e.manufacturer ? manufacturerIdByName.get(e.manufacturer) : undefined) ?? null,
        model: e.model ?? null,
        serialNumber: e.serialNumber ?? null,
        installedAt: e.installedAt ?? null,
        note: e.note ?? null,
        location: e.location ?? null,
        status: e.status ?? "active",
      });
      equipment++;
    }

    // A ship cover is a plain project cover.
    if (s.cover) {
      const file = await assetFile(COVERS_DIR, s.cover);
      await setProjectCover(db, config, project.id, file, uId(ADMIN_KEY));
    }
  }
  return { ships: recs.length, equipment };
}

async function importWorklists(db: AppDatabase): Promise<number> {
  const recs = await readJson<{ global: MaintRec[]; project: MaintRec[] }>("worklists");
  let count = 0;
  for (const t of recs.global) {
    const wl = await createGlobalWorklist(db, {
      name: t.name ?? t.key,
      // The old free-text `category` maps to a single worklist tag.
      tags: t.category ? [t.category] : [],
      checklist: t.checklist,
      precautions: t.precautions,
    });
    globalWorklistId.set(t.key, wl.id);
    seededWorklistRefs.push({ id: wl.id, name: wl.name });
    count++;
  }
  // Project-level worklists (`worklists.project_id`); the global entries above
  // keep a NULL project_id and stay the shared knowledge base.
  for (const t of recs.project) {
    const projectId = shipProjectId.get(t.project!);
    if (!projectId)
      throw new Error(`Worklist ${t.key} references unknown ship project ${t.project}`);
    const result = await createProjectWorklist(db, projectId, {
      name: t.name,
      // The old free-text `category` maps to a single worklist tag.
      tags: t.category ? [t.category] : [],
      checklist: t.checklist,
      precautions: t.precautions,
      fromGlobalId: t.fromGlobal ? globalWorklistId.get(t.fromGlobal) : undefined,
    });
    if (result.status === "ok")
      seededWorklistRefs.push({ id: result.worklist.id, name: result.worklist.name });
    count++;
  }
  return count;
}

async function importProjects(db: AppDatabase, config: Config): Promise<void> {
  const recs = await readJson<ProjectRec[]>("projects");
  for (const p of recs) {
    const creatorUserId = uId(p.creator);
    const parentShortId = p.parent ? shipProjectShortId.get(p.parent) : undefined;
    if (p.parent && !parentShortId)
      throw new Error(`Project ${p.key} references unknown ship project ${p.parent}`);
    const project = await createProject(db, {
      name: p.name,
      creatorId: creatorUserId,
      description: p.description ?? null,
      tags: p.tags ?? [],
      // A project bound to a vessel is now a SUB-PROJECT of that vessel's own
      // project (`parentId` takes the parent's short id). One level deep, so a
      // ship project is never itself a child.
      ...(parentShortId ? { parentId: parentShortId } : {}),
    });

    // The creator is auto-added with the Owner (system) role; the "Reader"
    // preset is used for added members (read-only access by default).
    const roles = await listRoles(db, project.id);
    const memberRole = roles.find(r => r.name === "Reader" && r.isSystem === 0);
    if (!memberRole)
      throw new Error(`No Reader role on project ${p.key}`);

    // Members map to a real or virtual `users` row (userId is required). Virtual
    // members are external operators with no login identity: a `users` row with
    // is_virtual=true is minted from the record's username/name, and the member
    // row records its job `title`. Only real members rotate as issue/comment
    // authors (virtual users are hidden from those pickers), so virtual members
    // are not pushed onto `members`.
    const members: { memberId: string; userId: string }[] = [];
    for (const m of p.members ?? []) {
      if (m.user) {
        const member = await addMember(db, project.id, { roleId: memberRole.id, userId: uId(m.user) });
        members.push({ memberId: member.id, userId: uId(m.user) });
      }
      else {
        const vUser = await createVirtualUser(db, { username: m.username!, name: m.name! });
        await addMember(db, project.id, { roleId: memberRole.id, userId: vUser!.id, title: m.title ?? null });
      }
    }

    // The `procurement` section's provision hook already copied the global
    // category template into this project; index that copy by name so the
    // procurement templates can resolve their category. Nothing is created
    // here — a second `createCategory` would only duplicate the copy.
    const categoryIds = new Map<string, string>();
    for (const cat of await listCategories(db, project.id))
      categoryIds.set(cat.name, cat.id);
    if (categoryIds.size === 0)
      throw new Error(`Project ${p.key} copied no procurement categories; seed the global template before creating projects`);

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
      seededIssueItemIds.push(item.id);

      // Attachment on the issue (owner_type='item_attachment', owner=item.id).
      if (t.attachment) {
        const file = await assetFile(ATTACH_DIR, t.attachment);
        await uploadAndReference(db, config, {
          file,
          ownerType: "item_attachment",
          ownerId: item.id,
          uploadedBy: proj.creatorUserId,
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
        tags: t.tags ?? [],
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
        });
        attachments++;
      }
      idx++;
    }
  }
  return { procurements, attachments };
}

/**
 * Attach soft worklist references (issue_references.refType='worklist') to a
 * handful of seeded issues. refIds cycle through the seeded worklist ids (global
 * + ship), all valid rows in the `worklists` table.
 */
async function importIssueReferences(db: AppDatabase): Promise<number> {
  if (seededWorklistRefs.length === 0)
    return 0;
  const targetCount = Math.min(6, seededIssueItemIds.length);
  let count = 0;
  for (let i = 0; i < targetCount; i++) {
    const itemId = seededIssueItemIds[i]!;
    const wl = seededWorklistRefs[i % seededWorklistRefs.length]!;
    await addReference(db, itemId, { refType: "worklist", refId: wl.id, label: wl.name });
    count++;
  }
  return count;
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
    // A ship is created through the project path, so it audits as a project.
    { action: "project.created", resourceType: "project", resourceName: "Aurora", result: "success", actor: "admin" },
    { action: "project.created", resourceType: "project", resourceName: "Aurora Dry-Dock Refit 2026", result: "success", actor: "pm-mercer" },
    { action: "issue.updated", resourceType: "issue", resourceName: "Replace bridge navigation radar", result: "success", actor: "eng-lin" },
    { action: "procurement.created", resourceType: "procurement", resourceName: "NR-900X navigation radar unit", result: "success", actor: "pm-mercer" },
    { action: "document.shared", resourceType: "document", resourceName: "Fleet Operations Handbook", result: "success", actor: "admin" },
    { action: "auth.login", resourceType: "session", resourceName: "admin@bit.hk", result: "success", actor: "admin" },
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

async function importHr(db: AppDatabase): Promise<{ colleagues: number; approvals: number; payroll: number }> {
  const data = await readJson<{ colleagues: HrColleagueRec[]; approvals: HrApprovalRec[]; payroll: HrPayrollRec[] }>("hr");
  const colleagueId = new Map<string, string>();

  for (const c of data.colleagues) {
    const colleague = await createColleague(db, {
      userId: uId(c.user),
      code: c.code,
      title: c.title,
      department: c.department,
      notes: c.notes,
      birthday: c.birthday,
      hireDate: c.hireDate,
      probationEndDate: c.probationEndDate,
      contractEndDate: c.contractEndDate,
      gender: c.gender,
      employmentType: c.employmentType,
      nationality: c.nationality,
      personalPhone: c.personalPhone,
      personalEmail: c.personalEmail,
      address: c.address,
      workLocation: c.workLocation,
      paymentInfo: c.paymentInfo,
      emergencyContacts: c.emergencyContacts,
    });
    if (!colleague)
      throw new Error(`HR colleague ${c.key} was not created`);
    colleagueId.set(c.key, colleague.id);
  }

  for (const a of data.approvals) {
    const cid = colleagueId.get(a.colleague);
    if (!cid)
      throw new Error(`HR approval references unknown colleague ${a.colleague}`);
    const approval = await createApproval(db, {
      colleagueId: cid,
      type: a.type,
      title: a.title,
      reason: a.reason,
    });
    if (!approval)
      throw new Error(`HR approval for colleague ${a.colleague} was not created`);
    // Decided records exercise the approve/reject path; pending ones stay open.
    if (a.decision === "approved" || a.decision === "rejected") {
      await decideApproval(db, approval.id, {
        status: a.decision,
        note: a.note,
        deciderId: uId(a.decider!),
      });
    }
  }

  for (const p of data.payroll) {
    const cid = colleagueId.get(p.colleague);
    if (!cid)
      throw new Error(`HR payroll references unknown colleague ${p.colleague}`);
    const record = await createPayrollRecord(db, {
      colleagueId: cid,
      period: p.period,
      baseSalary: p.baseSalary,
      bonus: p.bonus,
      deduction: p.deduction,
      currency: p.currency,
      notes: p.notes,
    });
    if (!record)
      throw new Error(`HR payroll record for colleague ${p.colleague} was not created`);
    // The pending -> paid transition is one-way; only mark records flagged paid.
    if (p.status === "paid")
      await updatePayrollRecord(db, record.id, { status: "paid" });
  }

  return { colleagues: data.colleagues.length, approvals: data.approvals.length, payroll: data.payroll.length };
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
  const db = await createDb(dbPath);
  await initFileModule(config, db);

  try {
    await importUsers(db);
    await importGroups(db);
    const contactCategories = await importContactCategories(db);
    await importContacts(db);

    // ORDER MATTERS: both global vocabularies are copied into a project by a
    // section provision hook at CREATE time (procurement categories for every
    // preset, equipment categories for the ship preset). Seed them before the
    // first project or every project copies an empty template.
    const globalProcCategories = await importGlobalProcurementCategories(db);
    const equipmentCategories = await importEquipmentCategories(db);
    const manufacturerIdByName = await importEquipmentManufacturers(db);

    const ships = await importShipProjects(db, config, manufacturerIdByName);
    const worklistCount = await importWorklists(db);
    await importProjects(db, config);
    const issues = await importIssues(db, config);
    const procurements = await importProcurements(db, config);
    const issueRefs = await importIssueReferences(db);
    const documents = await importDocuments(db, config);
    const drive = await importDrive(db, config);
    const cron = await importCron(db);
    const audits = await importAudit(db);
    const settingsCount = await importSettings(db);
    const hr = await importHr(db);

    // A missing mount row hides a core tab with no error anywhere, so the seed
    // refuses to report success until every project carries its preset's
    // sections. Mirrored by `seed.integrity.test.ts` so CI enforces it too.
    const mounts = await assertMountIntegrity(db);

    console.log("Seed complete:");
    console.log(`  users:        ${userId.size}`);
    console.log(`  groups:       (with members)`);
    console.log(`  contact cats: ${contactCategories}`);
    console.log(`  contacts:     ${contactId.size}`);
    console.log(`  equip cats:   ${equipmentCategories} (bilingual)`);
    console.log(`  equip mfrs:   ${manufacturerIdByName.size}`);
    console.log(`  global proc cats: ${globalProcCategories}`);
    console.log(`  ships:        ${ships.ships} ship-preset projects (${ships.equipment} equipment)`);
    console.log(`  worklists:    ${worklistCount}`);
    console.log(`  projects:     ${projectInfo.size} general-preset (${mounts.projects} total incl. ships)`);
    console.log(`  issues:       ${issues.issues} (${issues.comments} comments, ${issues.attachments} attachments)`);
    console.log(`  issue refs:   ${issueRefs} (worklist references)`);
    console.log(`  procurements: ${procurements.procurements} (${procurements.attachments} attachments)`);
    console.log(`  documents:    ${documents.documents} (${documents.pins} pins, ${documents.shares} shares, ${documents.attachments} attachments)`);
    console.log(`  drive:        ${drive.directories} team dirs, ${drive.entries} entries, ${drive.versions} extra versions, ${drive.shares} shares`);
    console.log(`  cron:         ${cron.jobs} jobs, ${cron.logs} logs`);
    console.log(`  audit:        ${audits} events`);
    console.log(`  settings:     ${settingsCount}`);
    console.log(`  hr:           ${hr.colleagues} colleagues, ${hr.approvals} approvals, ${hr.payroll} payroll records`);
    console.log(`  mounts:       ${mounts.projects} projects (${mounts.ships} ships) pass the section integrity check`);
    console.log(`\nAdmin account: admin@bit.hk (seeded with role=admin and the bundled dex oauth_sub, so logging in via dex keeps the admin role and owns the seeded drive/team data).`);
  }
  finally {
    db.close();
  }
}

await main();
