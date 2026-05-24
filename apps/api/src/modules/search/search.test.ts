import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createDocument } from "@/modules/document/document.service";
import { driveEntries } from "@/modules/drive/schema";
import { createIssue } from "@/modules/issue/issue.service";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createProject } from "@/modules/project/project.service";
import { globalSearch } from "./search.service";
import "@/modules/account";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

async function seedDriveFile(ownerId: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(driveEntries).values({
    id: nanoid(),
    ownerType: "user",
    ownerId,
    parentEntryId: "",
    entryType: "file",
    name,
    fileReferenceId: null,
    favorite: "0",
    status: "normal",
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  }).run();
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-search-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  loadNamespaces();
});

afterEach(() => {
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

const ARGS = { isAdmin: false, q: "Quarterly", limit: 8 };

describe("globalSearch", () => {
  test("blank query returns empty groups", async () => {
    const owner = await seedUser("Owner");
    const result = await globalSearch(db, { userId: owner, isAdmin: false, q: "   ", limit: 8 });
    expect(result).toEqual({ documents: [], issues: [], projects: [], drive: [], ships: [] });
  });

  test("returns the caller's own document, issue, project and drive file", async () => {
    const owner = await seedUser("Owner");
    await createDocument(db, { title: "Quarterly Report", creatorId: owner });
    const project = await createProject(db, { name: "Quarterly Project", creatorId: owner });
    await createIssue(db, { title: "Quarterly Bug", creatorId: owner, projectId: project.id });
    await seedDriveFile(owner, "Quarterly Notes.txt");

    const result = await globalSearch(db, { userId: owner, ...ARGS });

    expect(result.documents.map(h => h.title)).toContain("Quarterly Report");
    expect(result.issues.map(h => h.title)).toContain("Quarterly Bug");
    expect(result.projects.map(h => h.id)).toContain(project.shortId);
    expect(result.drive.map(h => h.title)).toContain("Quarterly Notes.txt");
  });

  test("does not leak another user's resources to a non-member", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    await createDocument(db, { title: "Quarterly Report", creatorId: owner });
    const project = await createProject(db, { name: "Quarterly Project", creatorId: owner });
    await createIssue(db, { title: "Quarterly Bug", creatorId: owner, projectId: project.id });
    await seedDriveFile(owner, "Quarterly Notes.txt");

    const result = await globalSearch(db, { userId: stranger, ...ARGS });

    expect(result.documents).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
    expect(result.drive).toHaveLength(0);
  });

  test("an admin sees every matching project", async () => {
    const owner = await seedUser("Owner");
    const admin = await seedUser("Admin");
    await createProject(db, { name: "Quarterly Project", creatorId: owner });

    const asMember = await globalSearch(db, { userId: admin, ...ARGS });
    expect(asMember.projects).toHaveLength(0);

    const asAdmin = await globalSearch(db, { userId: admin, isAdmin: true, q: "Quarterly", limit: 8 });
    expect(asAdmin.projects.map(h => h.title)).toContain("Quarterly Project");
  });
});
