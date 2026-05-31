import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { createDb } from "@/db";
import { streamJsonBackup } from "@/modules/backup/export.service";
import { __resetBackupRegistryForTests, getDataModules, registerBackupContribution } from "@/modules/backup/registry";
import { importJsonBackup, validateBackupData } from "@/modules/backup/restore.service";
import { tags, tagsRefs } from "@/modules/tag/schema";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { contactBackupContribution } from "./contact.backup";
import { contacts } from "./schema";

let sourceDb: AppDatabase;
let restoredDb: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolvePath(tmpdir(), "test-contact-backup-"));
  sourceDb = await createDb(resolvePath(dir, "source.db"));
  restoredDb = await createDb(resolvePath(dir, "restored.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(tagBackupContribution);
  registerBackupContribution(contactBackupContribution);
});

afterEach(() => {
  sourceDb.close();
  restoredDb.close();
  __resetBackupRegistryForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("contact backup contribution", () => {
  test("registers the contacts module with FK-safe tables and deps", () => {
    const mod = getDataModules().contacts;
    expect(mod?.name).toBe("contacts");
    // Tag links now live in the shared `tags_refs` table (the `tags` module),
    // so the contacts contribution carries only the `contacts` table; `tags` is
    // listed as a dep so a contacts-only export still pulls the links in.
    expect(mod?.tables.map(table => getTableName(table))).toEqual(["contacts"]);
    expect(mod?.deps).toEqual(["tags"]);
  });

  test("contact index registers the contribution when imported", async () => {
    __resetBackupRegistryForTests();

    await import(`./index.ts?backup-registration=${Date.now()}`);

    const mod = getDataModules().contacts;
    expect(mod?.tables.map(table => getTableName(table))).toEqual(["contacts"]);
  });

  test("exports and restores contacts with tag links", async () => {
    const now = "2026-05-24T00:00:00.000Z";
    await sourceDb.insert(tags).values({
      id: "tag_supplier",
      name: "supplier",
      type: "contact",
      createdAt: now,
      updatedAt: now,
    }).run();
    await sourceDb.insert(contacts).values({
      id: "contact_supplier",
      ownerId: "owner_1",
      name: "Supplier Co",
      contactPerson: "Alice",
      phone: "123",
      email: "alice@example.test",
      address: "Dock 1",
      taxId: "TAX-1",
      note: "Preferred",
      status: "active",
      visibility: "public",
      confidential: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    await sourceDb.insert(tagsRefs).values({
      resourceId: "contact_supplier",
      tagId: "tag_supplier",
    }).run();

    const { modules, body } = streamJsonBackup(sourceDb, ["contacts"]);
    const parsed = validateBackupData(JSON.parse(await readStreamToString(body)));
    expect(modules).toEqual(["tags", "contacts"]);
    expect(parsed.tables.contacts).toHaveLength(1);
    // The assignment link is exported under the shared `tags_refs` table.
    expect(parsed.tables.tags_refs).toHaveLength(1);

    const result = await importJsonBackup(restoredDb, parsed);
    expect(result.rowsImported).toBeGreaterThanOrEqual(3);

    const restoredContacts = await restoredDb
      .select({
        id: contacts.id,
        ownerId: contacts.ownerId,
        name: contacts.name,
        email: contacts.email,
      })
      .from(contacts)
      .all();
    expect(restoredContacts).toEqual([{
      id: "contact_supplier",
      ownerId: "owner_1",
      name: "Supplier Co",
      email: "alice@example.test",
    }]);

    const restoredTags = await restoredDb
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .all();
    expect(restoredTags).toEqual([{ id: "tag_supplier", name: "supplier" }]);

    const restoredLinks = await restoredDb
      .select({ resourceId: tagsRefs.resourceId, tagId: tagsRefs.tagId })
      .from(tagsRefs)
      .all();
    expect(restoredLinks).toEqual([{ resourceId: "contact_supplier", tagId: "tag_supplier" }]);
  });
});

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    if (value)
      out += decoder.decode(value);
  }
  return out;
}
