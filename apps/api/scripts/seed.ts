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
// Ship count is driven by the curated `YACHTS` dataset below, not by COUNTS.
const COUNTS = {
  users: 20,
  contacts: 30,
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
// Curated real-world yacht models spanning 5–50 m LOA, with size-consistent
// particulars. `gt` (gross tonnage) is only meaningful for the larger,
// commercially-measured vessels; small craft leave it null. IMO/MMSI/call-sign
// are assigned at seed time only to ≥24 m hulls (the rough threshold for
// commercial registration). Ordered by length so the dataset reads as a fleet.
interface YachtSpec {
  readonly name: string;
  readonly model: string;
  readonly builder: string;
  readonly buildYear: number;
  readonly loa: number;
  readonly beam: number;
  readonly draft: number;
  readonly gt: number | null;
  readonly flagState: string;
  readonly registryPort: string;
  readonly lifecycle: "design" | "building" | "sea_trial" | "in_service" | "maintenance" | "decommissioned";
}

const YACHTS: readonly YachtSpec[] = [
  { name: "Sea Sprite", model: "Williams DieselJet 565", builder: "Williams Jet Tenders", buildYear: 2021, loa: 5.6, beam: 2.1, draft: 0.45, gt: null, flagState: "United Kingdom", registryPort: "Southampton", lifecycle: "in_service" },
  { name: "Kingfisher", model: "Axopar 28 Cabin", builder: "Axopar Boats", buildYear: 2022, loa: 8.0, beam: 2.5, draft: 0.6, gt: null, flagState: "Finland", registryPort: "Helsinki", lifecycle: "in_service" },
  { name: "Marlin", model: "Sundancer 320", builder: "Sea Ray", buildYear: 2018, loa: 9.8, beam: 3.4, draft: 0.9, gt: null, flagState: "United States", registryPort: "Miami", lifecycle: "in_service" },
  { name: "Halcyon", model: "Cap Camarat 10.5 WA", builder: "Jeanneau", buildYear: 2020, loa: 10.6, beam: 3.4, draft: 0.85, gt: null, flagState: "France", registryPort: "Cannes", lifecycle: "in_service" },
  { name: "Aurelia", model: "Gran Turismo 41", builder: "Beneteau", buildYear: 2021, loa: 12.8, beam: 3.9, draft: 1.0, gt: null, flagState: "France", registryPort: "Nice", lifecycle: "in_service" },
  { name: "Vela", model: "V50", builder: "Princess Yachts", buildYear: 2017, loa: 15.6, beam: 4.3, draft: 1.2, gt: null, flagState: "Malta", registryPort: "Valletta", lifecycle: "maintenance" },
  { name: "Lumen", model: "55 Flybridge", builder: "Azimut", buildYear: 2019, loa: 16.7, beam: 4.8, draft: 1.45, gt: null, flagState: "Malta", registryPort: "Valletta", lifecycle: "in_service" },
  { name: "Tempest", model: "Predator 60", builder: "Sunseeker", buildYear: 2020, loa: 18.4, beam: 5.0, draft: 1.5, gt: null, flagState: "Jersey", registryPort: "St. Helier", lifecycle: "in_service" },
  { name: "Calypso", model: "Ferretti 670", builder: "Ferretti Yachts", buildYear: 2021, loa: 20.6, beam: 5.4, draft: 1.6, gt: null, flagState: "Italy", registryPort: "Genoa", lifecycle: "in_service" },
  { name: "Meridian", model: "Pershing 7X", builder: "Pershing", buildYear: 2022, loa: 22.0, beam: 5.6, draft: 1.65, gt: null, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "in_service" },
  { name: "Odyssey", model: "SL78", builder: "Sanlorenzo", buildYear: 2016, loa: 23.9, beam: 6.0, draft: 1.8, gt: null, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "maintenance" },
  { name: "Aquila", model: "90 Ocean", builder: "Sunseeker", buildYear: 2019, loa: 27.5, beam: 6.7, draft: 2.0, gt: 130, flagState: "Malta", registryPort: "Valletta", lifecycle: "in_service" },
  { name: "Serenity", model: "30M", builder: "Princess Yachts", buildYear: 2018, loa: 30.0, beam: 6.7, draft: 1.95, gt: 145, flagState: "Marshall Islands", registryPort: "Majuro", lifecycle: "in_service" },
  { name: "Mistral", model: "Mangusta 104", builder: "Overmarine", buildYear: 2015, loa: 32.0, beam: 7.0, draft: 1.6, gt: 160, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "maintenance" },
  { name: "Bluewater", model: "Delfino 95", builder: "Benetti", buildYear: 2020, loa: 33.0, beam: 7.6, draft: 2.25, gt: 250, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "in_service" },
  { name: "Aurora", model: "SD96", builder: "Sanlorenzo", buildYear: 2021, loa: 35.5, beam: 7.8, draft: 2.3, gt: 290, flagState: "Malta", registryPort: "Valletta", lifecycle: "in_service" },
  { name: "Nordwind", model: "38m Steel", builder: "Heesen Yachts", buildYear: 2017, loa: 38.0, beam: 8.0, draft: 2.4, gt: 330, flagState: "Gibraltar", registryPort: "Gibraltar", lifecycle: "in_service" },
  { name: "Polaris", model: "Amels 180", builder: "Amels", buildYear: 2019, loa: 40.0, beam: 8.2, draft: 2.45, gt: 450, flagState: "Isle of Man", registryPort: "Douglas", lifecycle: "in_service" },
  { name: "Costa Verde", model: "Mediterraneo 116", builder: "Benetti", buildYear: 2023, loa: 43.0, beam: 8.6, draft: 2.5, gt: 380, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "sea_trial" },
  { name: "Valkyrie", model: "Heesen 4500", builder: "Heesen Yachts", buildYear: 2024, loa: 45.0, beam: 8.6, draft: 2.55, gt: 495, flagState: "Marshall Islands", registryPort: "Majuro", lifecycle: "building" },
  { name: "Vantage", model: "F45 Vantage", builder: "Feadship", buildYear: 2026, loa: 47.5, beam: 8.8, draft: 2.6, gt: 499, flagState: "Netherlands", registryPort: "Amsterdam", lifecycle: "design" },
  { name: "Leviathan", model: "Amels 165", builder: "Amels", buildYear: 2022, loa: 50.0, beam: 9.0, draft: 2.7, gt: 650, flagState: "Cayman Islands", registryPort: "George Town", lifecycle: "in_service" },
] as const;

const EQUIPMENT = ["Main Engine", "Auxiliary Generator", "Navigation Radar", "Bow Thruster", "Stern Thruster", "Steering Gear", "Fire Pump", "Watermaker", "Air Conditioning Plant", "Zero-Speed Stabilizers", "Tender Crane", "Autopilot", "Liferaft Station"] as const;
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

/** Registration identifiers are only minted for ≥24 m hulls. */
function registration(loa: number): { imoNumber: string | null; mmsi: string | null; callSign: string | null } {
  if (loa < 24)
    return { imoNumber: null, mmsi: null, callSign: null };
  return {
    imoNumber: `9${randInt(100000, 999999)}`,
    mmsi: `2${randInt(10_000_000, 99_999_999)}`,
    callSign: `2${pick(["A", "B", "C", "D", "E"])}${pick(["X", "Y", "Z"])}${randInt(1000, 9999)}`,
  };
}

async function seedShips(db: AppDatabase): Promise<{ shipsCreated: SeededShip[]; equipment: number }> {
  const shipsCreated: SeededShip[] = [];
  let equipment = 0;
  for (const y of YACHTS) {
    const reg = registration(y.loa);
    const ship = await createShip(db, {
      name: y.name,
      creatorId: ADMIN_ID,
      lifecycleStage: y.lifecycle,
      model: y.model,
      builder: y.builder,
      buildYear: y.buildYear,
      lengthOverall: y.loa,
      beam: y.beam,
      draft: y.draft,
      grossTonnage: y.gt,
      imoNumber: reg.imoNumber,
      mmsi: reg.mmsi,
      callSign: reg.callSign,
      flagState: y.flagState,
      registryPort: y.registryPort,
      ownerName: `${pick(COMPANY_A)} Yachting Ltd`,
      description: `${y.builder} ${y.model} — ${y.loa} m motor yacht.`,
    });
    shipsCreated.push({ id: ship.id, shortId: ship.shortId });

    // Larger vessels carry more systems.
    const equipCount = y.loa < 15 ? randInt(1, 2) : y.loa < 30 ? randInt(2, 4) : randInt(3, 6);
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

  return { contacts: contactCount, ships: shipsCreated.length, equipment, projects: projectPool.length, issues, procurements, documents, covers };
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
