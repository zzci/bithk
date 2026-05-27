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
 * Volume is driven by `COUNTS` and generated from fixed vocab pools through a
 * seeded PRNG, so every run (after `--fresh`) produces the same dataset. Tune
 * `COUNTS` to scale the data up or down.
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
import { loadConfigStrict } from "@/config";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import * as contactService from "@/modules/contact/contact.service";
import { contacts } from "@/modules/contact/schema";
import { createDocument } from "@/modules/document/document.service";
import { initFileModule } from "@/modules/file";
import { createIssue } from "@/modules/issue/issue.service";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { createCategory } from "@/modules/project/project.categories";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject, setProjectCover } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { settings } from "@/modules/settings/schema";
import { ships } from "@/modules/ship/schema";
import { createEquipment } from "@/modules/ship/ship.equipment.service";
import { bindProject, createShip, setShipCover } from "@/modules/ship/ship.service";
import { ROOT_DIR } from "@/root";

const MARKER_KEY = "seed:applied";
const ADMIN_ID = "seed-user-admin";

// Target volumes. Bump these to scale the dataset; counts flow through the
// generators below so nothing else needs to change.
const COUNTS = {
  users: 20,
  contacts: 30,
  ships: 20,
  projects: 10,
  issues: 30,
  procurements: 20,
  documents: 20,
} as const;

// Fraction of ships / standalone projects that get a fetched cover image; the
// rest are intentionally left without one. Images come from picsum.photos, so
// covers are skipped gracefully (no failure) when the network is unavailable.
const COVER_RATIO = 0.7;

// ─── Deterministic randomness ───────────────────────────────────────────
// mulberry32 — a tiny seeded PRNG so every run yields the same data.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260525);
const randInt = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)]!;
const chance = (p: number): boolean => rng() < p;

function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** ISO date `days` after 2026-01-01. */
function dayOffset(days: number): string {
  return new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

// ─── Vocab pools ──────────────────────────────────────────────────────────
const FIRST_NAMES = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj", "Olivia", "Peggy", "Quentin", "Rupert", "Sybil", "Trent", "Uma", "Victor", "Wendy", "Xander", "Yara", "Zane"] as const;
const LAST_NAMES = ["Chen", "Mercer", "Diaz", "Lin", "Voss", "Whitfield", "Okafor", "Nguyen", "Kowalski", "Rossi", "Haddad", "Schmidt", "Larsson", "Ferreira", "Tanaka", "Petrov", "Singh", "Murphy", "Costa", "Bauer"] as const;
const COMPANY_A = ["Oceanic", "RadarTech", "Blue Horizon", "Pacific", "Nordic", "Atlas", "Meridian", "Harbor", "Coastal", "Apex", "Titan", "Vanguard", "Summit", "Delta", "Orion"] as const;
const COMPANY_B = ["Marine Supplies", "Systems", "Charters", "Logistics", "Engineering", "Marine Services", "Electronics", "Shipyard", "Provisions", "Coatings"] as const;
const CONTACT_TAGS = ["supplier", "client", "deck", "electronics", "safety", "provisioning", "logistics"] as const;
const SHIP_PREFIX = ["MV", "SY", "MY", "RV", "FV"] as const;
const SHIP_NAMES = ["Aurora", "Meridian", "Orion", "Tethys", "Calypso", "Poseidon", "Nautilus", "Triton", "Halcyon", "Zephyr", "Odyssey", "Mistral", "Borealis", "Solace", "Tempest", "Horizon", "Seraphine", "Valkyrie", "Equinox", "Mariner", "Aquila", "Cygnus", "Lyra", "Vega"] as const;
const BUILDERS = ["Damen Shipyards", "Feadship", "Lürssen", "Oceanco", "Sunseeker", "Benetti", "Heesen", "Austal"] as const;
const FLAG_STATES = ["Singapore", "Cayman Islands", "Marshall Islands", "Malta", "Panama", "Bahamas", "Norway", "Netherlands"] as const;
const LIFECYCLE = ["design", "building", "sea_trial", "in_service", "maintenance", "decommissioned"] as const;
const EQUIPMENT = ["Main Engine", "Auxiliary Generator", "Navigation Radar", "Bow Thruster", "Steering Gear", "Fire Pump", "Watermaker", "HVAC Unit", "Stabilizer", "Liferaft Station"] as const;
const EQUIP_CATEGORIES = ["propulsion", "navigation", "safety", "deck", "electrical", "hvac"] as const;
const MANUFACTURERS = ["MAN Energy Solutions", "Caterpillar", "Wärtsilä", "Furuno", "Kongsberg", "Rolls-Royce", "ABB"] as const;
const PROJECT_KINDS = ["Dry-Dock Refit", "Newbuild", "Annual Survey", "Engine Overhaul", "Class Renewal", "Interior Refit", "Electronics Upgrade", "Hull Maintenance", "Sea Trial Prep", "Warranty Works"] as const;
const CATEGORY_NAMES = ["Deck Equipment", "Electronics", "Safety Gear", "Engine Parts", "Interior", "Provisions", "Paint & Coatings", "Electrical"] as const;
const ISSUE_TITLES = ["Inspect and recoat hull below waterline", "Replace bridge navigation radar", "Annual safety equipment audit", "Overhaul main engine", "Service bow thruster", "Renew class certificates", "Calibrate bridge sensors", "Replace emergency fire pump", "Test steering gear", "Update ECDIS charts", "Inspect lifeboats and davits", "Clean and gauge fuel tanks", "Repair HVAC compressor", "Replace sacrificial anodes", "Survey ballast water tanks"] as const;
const ISSUE_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const PROCUREMENT_ITEMS = ["Anti-fouling paint (200 L)", "Navigation radar unit", "Marine diesel fuel", "Safety harness set", "Engine spare parts kit", "LED deck lighting", "Liferaft (25-person)", "Hydraulic oil (drums)", "Bridge console module", "Provisioning supplies", "Mooring lines", "Bilge pump assembly"] as const;
const PROCUREMENT_STATUSES = ["draft", "requested", "ordered", "received", "closed"] as const;
const CURRENCIES = ["USD", "EUR", "SGD", "GBP"] as const;
const DOC_TITLES = ["Fleet Operations Handbook", "Dry-Dock Refit Procedure", "Safety Management Manual", "Emergency Response Plan", "Maintenance Schedule", "Crew Onboarding Guide", "Bunkering Checklist", "Class Survey Notes", "Equipment Inventory", "Voyage Planning SOP", "Bridge Resource Management", "Waste Management Plan"] as const;

// ─── Seed users ─────────────────────────────────────────────────────────
interface SeedUser {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "user";
}

// Usernames/emails are `seed-`/`@seed.local` namespaced so they never collide
// with a real account (the single-user `admin` in particular). A collision on a
// unique column would make `onConflictDoNothing` silently skip the row, leaving
// later FK inserts (relation tuples) dangling.
function buildSeedUsers(): SeedUser[] {
  const list: SeedUser[] = [
    { id: ADMIN_ID, username: "seed-admin", name: "Alice Admin", email: "admin@seed.local", role: "admin" },
  ];
  for (let i = 1; i < COUNTS.users; i++) {
    const num = String(i).padStart(3, "0");
    const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]}`;
    list.push({ id: `seed-user-${num}`, username: `seed-u${num}`, name, email: `u${num}@seed.local`, role: "user" });
  }
  return list;
}

const SEED_USERS = buildSeedUsers();
const SEED_USER_IDS = SEED_USERS.map(u => u.id);
const MEMBER_IDS = SEED_USERS.filter(u => u.id !== ADMIN_ID).map(u => u.id);

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
  equipment: number;
  projects: number;
  issues: number;
  procurements: number;
  documents: number;
  covers: number;
}

interface SeededProject {
  readonly id: string;
  readonly shortId: string;
  readonly creatorId: string;
  readonly memberIds: string[];
  readonly categoryIds: string[];
}

async function seedContacts(db: AppDatabase): Promise<{ supplierIds: string[]; count: number }> {
  const adminActor = { id: ADMIN_ID, role: "admin" };
  const supplierIds: string[] = [];
  for (let i = 0; i < COUNTS.contacts; i++) {
    const isSupplier = chance(0.6);
    const tags = isSupplier ? ["supplier", pick(CONTACT_TAGS)] : ["client"];
    const company = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
    const contact = await contactService.create(db, adminActor, {
      name: company,
      contactPerson: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: `contact${i}@${company.toLowerCase().replace(/[^a-z]+/g, "-")}.example`,
      phone: `+${randInt(1, 99)} ${randInt(10, 99)} ${randInt(1000, 9999)}`,
      visibility: chance(0.5) ? "public" : "private",
      tags: [...new Set(tags)],
    });
    if (isSupplier)
      supplierIds.push(contact.id);
  }
  return { supplierIds, count: COUNTS.contacts };
}

interface SeededShip {
  readonly id: string;
  readonly shortId: string;
}

async function seedShips(db: AppDatabase): Promise<{ shipsCreated: SeededShip[]; equipment: number }> {
  const shipsCreated: SeededShip[] = [];
  let equipment = 0;
  for (let i = 0; i < COUNTS.ships; i++) {
    const name = `${pick(SHIP_PREFIX)} ${SHIP_NAMES[i % SHIP_NAMES.length]}${i >= SHIP_NAMES.length ? ` ${Math.floor(i / SHIP_NAMES.length) + 1}` : ""}`;
    const ship = await createShip(db, {
      name,
      creatorId: ADMIN_ID,
      lifecycleStage: pick(LIFECYCLE),
      builder: pick(BUILDERS),
      buildYear: randInt(2005, 2026),
      grossTonnage: randInt(500, 9000),
      imoNumber: `9${randInt(100000, 999999)}`,
      flagState: pick(FLAG_STATES),
      ownerName: `${pick(COMPANY_A)} Holdings Ltd`,
      description: "Demo vessel record.",
    });
    shipsCreated.push({ id: ship.id, shortId: ship.shortId });
    const equipCount = randInt(1, 3);
    for (const eqName of sample(EQUIPMENT, equipCount)) {
      await createEquipment(db, ship.id, {
        name: eqName,
        category: pick(EQUIP_CATEGORIES),
        manufacturer: pick(MANUFACTURERS),
        model: `${pick(["X", "Z", "NR", "GT"])}-${randInt(100, 999)}`,
        location: pick(["Engine room", "Bridge", "Deck", "Aft station"]),
        status: chance(0.85) ? "active" : "retired",
      });
      equipment++;
    }
  }
  return { shipsCreated, equipment };
}

async function tryFetchImage(url: string, name: string): Promise<File | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok)
      return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0)
      return null;
    return new File([buffer], name, { type: res.headers.get("content-type") ?? "image/jpeg" });
  }
  catch {
    return null;
  }
}

/**
 * Fetch a topical demo cover image as a `File`. Primary source is LoremFlickr
 * (keyword-matched photos, deterministic via `lock`), with picsum.photos as a
 * generic fallback. Returns null on total failure so seeding continues without
 * a cover instead of aborting.
 */
async function fetchCoverFile(keywords: string, lock: number, name: string): Promise<File | null> {
  return (
    await tryFetchImage(`https://loremflickr.com/1200/800/${keywords}?lock=${lock}`, name)
    ?? await tryFetchImage(`https://picsum.photos/seed/${keywords}-${lock}/1200/800`, name)
  );
}

/**
 * Attach fetched cover images to a fraction (`COVER_RATIO`) of the ships and
 * standalone projects, leaving the rest without one. Base projects are skipped
 * — they inherit their ship's cover. Returns the number of covers actually set.
 */
async function seedCovers(db: AppDatabase, shipsCreated: SeededShip[], projectPool: SeededProject[]): Promise<number> {
  const config = await loadConfigStrict(() => {});
  await initFileModule(config);

  let count = 0;
  // Ships get vessel imagery; standalone projects are maintenance/refit work
  // orders, so they get equipment/machinery imagery.
  for (let i = 0; i < shipsCreated.length; i++) {
    if (!chance(COVER_RATIO))
      continue;
    const file = await fetchCoverFile("ship,yacht,vessel", i + 1, `ship-${i}.jpg`);
    if (!file)
      continue;
    await setShipCover(db, config, shipsCreated[i]!.id, file, ADMIN_ID);
    count++;
  }
  for (let i = 0; i < projectPool.length; i++) {
    if (!chance(COVER_RATIO))
      continue;
    const file = await fetchCoverFile("ship,engine,machinery", i + 101, `project-${i}.jpg`);
    if (!file)
      continue;
    await setProjectCover(db, config, projectPool[i]!.id, file, projectPool[i]!.creatorId);
    count++;
  }
  return count;
}

async function seedProjects(db: AppDatabase, shipShortIds: string[]): Promise<SeededProject[]> {
  const result: SeededProject[] = [];
  for (let i = 0; i < COUNTS.projects; i++) {
    const creatorId = pick(MEMBER_IDS);
    const project = await createProject(db, {
      name: `${pick(PROJECT_KINDS)} ${randInt(2024, 2027)}`,
      creatorId,
      description: "Demo project record.",
      tags: sample(["refit", "survey", "newbuild", "warranty", "urgent"], randInt(1, 2)),
    });

    const roles = await listRoles(db, project.id);
    const memberRole = roles.find(r => r.isSystem === 0);
    if (!memberRole)
      throw new Error("Expected a default non-system 'Member' role on the new project");

    const memberIds: string[] = [];
    for (const userId of sample(MEMBER_IDS.filter(id => id !== creatorId), randInt(2, 5))) {
      const member = await addMember(db, project.id, { roleId: memberRole.id, userId });
      memberIds.push(member.id);
    }

    const categoryIds: string[] = [];
    for (const catName of sample(CATEGORY_NAMES, randInt(1, 3))) {
      const cat = await createCategory(db, project.id, { name: catName, code: catName.slice(0, 4).toUpperCase() });
      categoryIds.push(cat.id);
    }

    if (chance(0.6) && shipShortIds.length > 0)
      await bindProject(db, await resolveShipInternalId(db, pick(shipShortIds)), project.shortId);

    result.push({ id: project.id, shortId: project.shortId, creatorId, memberIds, categoryIds });
  }
  return result;
}

/** bindProject takes a ship internal id; resolve it from a short id. */
async function resolveShipInternalId(db: AppDatabase, shortId: string): Promise<string> {
  const row = await db.select({ id: ships.id }).from(ships).where(eq(ships.shortId, shortId)).get();
  if (!row)
    throw new Error(`Seed ship ${shortId} not found`);
  return row.id;
}

async function seedIssues(db: AppDatabase, projectPool: SeededProject[]): Promise<number> {
  for (let i = 0; i < COUNTS.issues; i++) {
    const project = pick(projectPool);
    const assign = project.memberIds.length > 0 && chance(0.5);
    await createIssue(db, {
      title: pick(ISSUE_TITLES),
      description: "Demo work order.",
      projectId: project.id,
      creatorId: project.creatorId,
      priority: pick(ISSUE_PRIORITIES),
      status: pick(ISSUE_STATUSES),
      ...(assign ? { assigneeMemberId: pick(project.memberIds) } : {}),
      ...(chance(0.4) ? { dueDate: dayOffset(randInt(120, 330)) } : {}),
    });
  }
  return COUNTS.issues;
}

async function seedProcurements(db: AppDatabase, projectPool: SeededProject[], supplierIds: string[]): Promise<number> {
  for (let i = 0; i < COUNTS.procurements; i++) {
    const project = pick(projectPool);
    await createProcurement(db, {
      projectId: project.id,
      itemName: pick(PROCUREMENT_ITEMS),
      creatorId: project.creatorId,
      ...(supplierIds.length > 0 && chance(0.8) ? { supplierId: pick(supplierIds) } : {}),
      ...(project.categoryIds.length > 0 ? { categoryId: pick(project.categoryIds) } : {}),
      quantity: randInt(1, 500),
      amount: randInt(500, 80_000),
      currency: pick(CURRENCIES),
      status: pick(PROCUREMENT_STATUSES),
    });
  }
  return COUNTS.procurements;
}

async function seedDocuments(db: AppDatabase): Promise<number> {
  const shortIds: string[] = [];
  const roots = Math.max(1, Math.round(COUNTS.documents / 4));
  for (let i = 0; i < COUNTS.documents; i++) {
    const isChild = i >= roots && shortIds.length > 0 && chance(0.7);
    const doc = await createDocument(db, {
      title: `${pick(DOC_TITLES)}${i >= DOC_TITLES.length ? ` (${i})` : ""}`,
      content: `# ${pick(DOC_TITLES)}\n\nDemo document body for development.`,
      tags: sample(["handbook", "procedure", "safety", "reference"], randInt(0, 2)),
      creatorId: pick(SEED_USER_IDS),
      ...(isChild ? { parentId: pick(shortIds) } : {}),
    });
    shortIds.push(doc.id);
  }
  return COUNTS.documents;
}

async function seedContent(db: AppDatabase): Promise<SeedCounts> {
  const { supplierIds, count: contactCount } = await seedContacts(db);
  const { shipsCreated, equipment } = await seedShips(db);
  const projectPool = await seedProjects(db, shipsCreated.map(s => s.shortId));
  const issues = await seedIssues(db, projectPool);
  const procurements = await seedProcurements(db, projectPool, supplierIds);
  const documents = await seedDocuments(db);
  const covers = await seedCovers(db, shipsCreated, projectPool);

  await db.insert(settings).values({
    key: MARKER_KEY,
    value: new Date().toISOString(),
    updatedBy: ADMIN_ID,
  }).run();

  return { contacts: contactCount, ships: COUNTS.ships, equipment, projects: projectPool.length, issues, procurements, documents, covers };
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
    console.log(`  ships:        ${counts.ships} (+ base projects, ${counts.equipment} equipment)`);
    console.log(`  projects:     ${counts.projects} standalone`);
    console.log(`  issues:       ${counts.issues}`);
    console.log(`  procurements: ${counts.procurements}`);
    console.log(`  documents:    ${counts.documents}`);
    console.log(`  cover images: ${counts.covers} (ships + standalone projects; some left unset)`);
    console.log(`\nAdmin demo account: username "${SEED_USERS[0]!.username}" (oauth_sub "seed|${SEED_USERS[0]!.username}", ${SEED_USERS[0]!.email}).`);
  }
  finally {
    db.close();
  }
}

await main();
