#!/usr/bin/env bun
/**
 * Seed the local SQLite database with coherent demo data for development.
 *
 * Usage:
 *   bun run seed            # idempotent: seeds once, re-runs are no-ops
 *   bun run seed --fresh    # wipe previously seeded data, then reseed
 *
 * Targets the database at $DB_PATH (default data/db/app.db), resolved against
 * the monorepo root — the same file the API serves from. Data is written
 * through the existing service-layer creators wherever one exists, so it stays
 * in sync with schema and business defaults; only `users` (no creator service,
 * they are normally provisioned via OAuth) are inserted directly.
 *
 * Idempotency: a marker row in `settings` records that the demo content has
 * been seeded. Seed users carry stable `seed-…` ids, so `--fresh` can remove
 * exactly the seeded data (and nothing a real login created) before reseeding.
 */
/* eslint-disable no-console */
import type { AppDatabase } from "@/db";
import { resolve } from "node:path";
import process from "node:process";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import * as contactService from "@/modules/contact/contact.service";
import { contacts } from "@/modules/contact/schema";
import { createDocument } from "@/modules/document/document.service";
import { createIssue } from "@/modules/issue/issue.service";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { createCategory } from "@/modules/project/project.categories";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { settings } from "@/modules/settings/schema";
import { ships } from "@/modules/ship/schema";
import { createEquipment } from "@/modules/ship/ship.equipment.service";
import { bindProject, createShip } from "@/modules/ship/ship.service";
import { ROOT_DIR } from "@/root";

const MARKER_KEY = "seed:applied";

const ADMIN_ID = "seed-user-admin";

// Usernames/emails are `seed-`/`@seed.local` namespaced so they never collide
// with a real account (the single-user `admin` in particular). A collision on a
// unique column would make `onConflictDoNothing` silently skip the row, leaving
// later FK inserts (relation tuples) dangling.
const SEED_USERS = [
  { id: ADMIN_ID, username: "seed-admin", name: "Alice Admin", email: "admin@seed.local", role: "admin" },
  { id: "seed-user-pm", username: "seed-pm", name: "Bob Mercer", email: "pm@seed.local", role: "user" },
  { id: "seed-user-eng", username: "seed-eng", name: "Carol Diaz", email: "eng@seed.local", role: "user" },
  { id: "seed-user-ext", username: "seed-ext", name: "Dave Lin", email: "ext@seed.local", role: "user" },
] as const;

const SEED_USER_IDS = SEED_USERS.map(u => u.id);

async function isSeeded(db: AppDatabase): Promise<boolean> {
  const row = await db.select().from(settings).where(eq(settings.key, MARKER_KEY)).get();
  return !!row;
}

/** Insert the demo accounts. Idempotent — existing rows are left untouched. */
async function ensureUsers(db: AppDatabase): Promise<void> {
  for (const u of SEED_USERS) {
    await db.insert(users).values({
      id: u.id,
      oauthSub: `seed|${u.username}`,
      username: u.username,
      name: u.name,
      email: u.email,
      role: u.role,
    }).onConflictDoNothing().run();
  }

  // Fail fast if any seed user is missing: a unique-field collision with an
  // existing account makes `onConflictDoNothing` skip the row, which would
  // otherwise surface later as a cryptic FK error on a dependent insert.
  const present = await db.select({ id: users.id }).from(users).where(inArray(users.id, SEED_USER_IDS)).all();
  if (present.length !== SEED_USERS.length) {
    const have = new Set(present.map(r => r.id));
    const missing = SEED_USERS.filter(u => !have.has(u.id)).map(u => `${u.id} (username "${u.username}", email ${u.email})`);
    throw new Error(`Seed user(s) could not be inserted — a unique field likely collides with an existing account: ${missing.join(", ")}`);
  }
}

/**
 * Remove everything the seed created. Deletions rely on FK cascades: dropping
 * the owning `items` / `projects` / `ships` rows takes their detail, role,
 * member, category and equipment rows with them. `contacts.owner_id` and
 * `relation_tuples.created_by` carry no FK, so those are deleted explicitly.
 *
 * The whole thing runs in one transaction with `defer_foreign_keys` so FK
 * checks are postponed to COMMIT: the `ships.base_project_id ↔ projects.ship_id`
 * cycle (the migration added `projects.ship_id` as a plain NO-ACTION reference)
 * would otherwise reject the deletes whatever order they run in.
 */
function wipe(db: AppDatabase): void {
  db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = ON`);
    tx.delete(items).where(inArray(items.creatorId, SEED_USER_IDS)).run();
    tx.delete(projects).where(inArray(projects.creatorId, SEED_USER_IDS)).run();
    tx.delete(ships).where(inArray(ships.creatorId, SEED_USER_IDS)).run();
    tx.delete(contacts).where(inArray(contacts.ownerId, SEED_USER_IDS)).run();
    tx.delete(relationTuples).where(inArray(relationTuples.createdBy, SEED_USER_IDS)).run();
    tx.delete(settings).where(eq(settings.key, MARKER_KEY)).run();
    tx.delete(users).where(inArray(users.id, SEED_USER_IDS)).run();
  });
}

interface SeedCounts {
  contacts: number;
  ships: number;
  projects: number;
  issues: number;
  procurements: number;
  documents: number;
}

async function seedContent(db: AppDatabase): Promise<SeedCounts> {
  const adminActor = { id: ADMIN_ID, role: "admin" };

  // ── Contacts (suppliers + a client) ───────────────────────────────────
  const oceanic = await contactService.create(db, adminActor, {
    name: "Oceanic Marine Supplies",
    contactPerson: "Maria Chen",
    email: "sales@oceanic-marine.example",
    phone: "+65 6123 4567",
    address: "12 Harbour Rd, Singapore",
    visibility: "public",
    tags: ["supplier", "deck"],
  });
  const radarTech = await contactService.create(db, adminActor, {
    name: "RadarTech Systems",
    contactPerson: "Ingrid Voss",
    email: "orders@radartech.example",
    phone: "+49 40 998877",
    visibility: "public",
    tags: ["supplier", "electronics"],
  });
  await contactService.create(db, adminActor, {
    name: "Blue Horizon Charters",
    contactPerson: "Tom Whitfield",
    email: "ops@bluehorizon.example",
    note: "Charter client for the Aurora.",
    tags: ["client"],
  });

  // ── Ships (each createShip also seeds a base project) ─────────────────
  const aurora = await createShip(db, {
    name: "MV Aurora",
    creatorId: ADMIN_ID,
    lifecycleStage: "in_service",
    builder: "Damen Shipyards",
    buildYear: 2019,
    grossTonnage: 4200,
    imoNumber: "9123456",
    flagState: "Singapore",
    registryPort: "Singapore",
    ownerName: "Aurora Holdings Ltd",
    description: "Offshore support vessel in active service.",
  });
  await createEquipment(db, aurora.id, {
    name: "Main Engine",
    category: "propulsion",
    manufacturer: "MAN Energy Solutions",
    model: "6L32/44CR",
    location: "Engine room",
    status: "active",
  });
  await createEquipment(db, aurora.id, {
    name: "Navigation Radar",
    category: "navigation",
    manufacturer: "RadarTech",
    model: "NR-900X",
    location: "Bridge",
    status: "active",
  });

  await createShip(db, {
    name: "SY Meridian",
    creatorId: ADMIN_ID,
    lifecycleStage: "building",
    builder: "Feadship",
    buildYear: 2026,
    grossTonnage: 980,
    flagState: "Cayman Islands",
    description: "Custom sailing yacht under construction.",
  });

  // ── Project with members, categories, ship binding ────────────────────
  const refit = await createProject(db, {
    name: "Aurora Dry-Dock Refit 2026",
    creatorId: "seed-user-pm",
    description: "Scheduled five-year dry-dock refit and class renewal.",
    tags: ["refit", "2026"],
  });

  const roles = await listRoles(db, refit.id);
  const memberRole = roles.find(r => r.isSystem === 0);
  if (!memberRole)
    throw new Error("Expected a default non-system 'Member' role on the new project");

  const engMember = await addMember(db, refit.id, { roleId: memberRole.id, userId: "seed-user-eng" });
  await addMember(db, refit.id, { roleId: memberRole.id, displayName: "External Surveyor", title: "Class Surveyor" });

  const deckCat = await createCategory(db, refit.id, { name: "Deck Equipment", code: "DECK" });
  const elecCat = await createCategory(db, refit.id, { name: "Electronics", code: "ELEC" });

  await bindProject(db, aurora.id, refit.shortId);

  // ── Issues (varied priority/status, one assigned) ─────────────────────
  await createIssue(db, {
    title: "Inspect and recoat hull below waterline",
    description: "Grit-blast and apply anti-fouling per spec.",
    projectId: refit.id,
    creatorId: "seed-user-pm",
    priority: "high",
    status: "open",
  });
  await createIssue(db, {
    title: "Replace bridge navigation radar",
    description: "Swap NR-900X unit; verify integration with ECDIS.",
    projectId: refit.id,
    creatorId: "seed-user-pm",
    priority: "urgent",
    status: "in_progress",
    assigneeMemberId: engMember.id,
    dueDate: "2026-06-15",
  });
  await createIssue(db, {
    title: "Annual safety equipment audit",
    projectId: refit.id,
    creatorId: "seed-user-eng",
    priority: "medium",
    status: "done",
  });

  // ── Procurement (linked to suppliers + categories) ────────────────────
  await createProcurement(db, {
    projectId: refit.id,
    itemName: "Anti-fouling paint (200 L)",
    creatorId: "seed-user-pm",
    supplierId: oceanic.id,
    categoryId: deckCat.id,
    quantity: 200,
    amount: 12000,
    currency: "USD",
    status: "requested",
  });
  await createProcurement(db, {
    projectId: refit.id,
    itemName: "NR-900X navigation radar unit",
    creatorId: "seed-user-pm",
    supplierId: radarTech.id,
    categoryId: elecCat.id,
    quantity: 1,
    amount: 45000,
    currency: "USD",
    status: "ordered",
  });

  // ── Documents (a small tree) ──────────────────────────────────────────
  const handbook = await createDocument(db, {
    title: "Fleet Operations Handbook",
    content: "# Fleet Operations Handbook\n\nStandard operating procedures for the fleet.",
    tags: ["handbook"],
    creatorId: ADMIN_ID,
  });
  await createDocument(db, {
    title: "Dry-Dock Refit Procedure",
    content: "## Refit Procedure\n\n1. Pre-docking survey\n2. Hull works\n3. Class renewal",
    parentId: handbook.id,
    creatorId: "seed-user-pm",
  });

  await db.insert(settings).values({
    key: MARKER_KEY,
    value: new Date().toISOString(),
    updatedBy: ADMIN_ID,
  }).run();

  return { contacts: 3, ships: 2, projects: 1, issues: 3, procurements: 2, documents: 2 };
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");
  const dbPath = resolve(ROOT_DIR, process.env.DB_PATH ?? "data/db/app.db");

  console.log(`Seeding database at ${dbPath}${fresh ? " (--fresh)" : ""}`);
  const db = await createDb(dbPath);

  try {
    if (fresh)
      wipe(db);

    if (await isSeeded(db)) {
      console.log("Demo data already present. Re-run with --fresh to reset.");
      return;
    }

    await ensureUsers(db);
    const counts = await seedContent(db);

    console.log("Seed complete:");
    console.log(`  users:        ${SEED_USERS.length}`);
    console.log(`  contacts:     ${counts.contacts}`);
    console.log(`  ships:        ${counts.ships} (+ base projects)`);
    console.log(`  projects:     ${counts.projects} standalone`);
    console.log(`  issues:       ${counts.issues}`);
    console.log(`  procurements: ${counts.procurements}`);
    console.log(`  documents:    ${counts.documents}`);
    console.log(`\nAdmin demo account: username "${SEED_USERS[0].username}" (oauth_sub "seed|${SEED_USERS[0].username}", ${SEED_USERS[0].email}).`);
  }
  finally {
    db.close();
  }
}

await main();
