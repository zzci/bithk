import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { createDb } from "@/db";
import { __resetBackupRegistryForTests, getDataModules, registerBackupContribution } from "@/modules/backup/registry";
import { tags, tagsRefs } from "@/modules/tag/schema";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { roundTripBackupV2 } from "@/shared/test/backup-roundtrip";
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
    // `contact_categories` is the global vocabulary referenced by
    // `contacts.category_id`; it is listed first so a restore inserts the
    // referenced rows before the contacts that point at them. Tag links live in
    // the shared `tags_refs` table (the `tags` module), listed as a dep so a
    // contacts-only export still pulls the links in.
    expect(mod?.tables.map(table => getTableName(table))).toEqual(["contact_categories", "contacts"]);
    expect(mod?.deps).toEqual(["tags"]);
  });

  test("contact index registers the contribution when imported", async () => {
    __resetBackupRegistryForTests();

    await import(`./index.ts?backup-registration=${Date.now()}`);

    const mod = getDataModules().contacts;
    expect(mod?.tables.map(table => getTableName(table))).toEqual(["contact_categories", "contacts"]);
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
      kind: "organization",
      ownerId: "owner_1",
      name: "Supplier Co",
      phone: "123",
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

    const { modules, tables, result } = await roundTripBackupV2(sourceDb, restoredDb, ["contacts"], dir);
    expect(modules).toEqual(["tags", "contacts"]);
    expect(tables.contacts).toHaveLength(1);
    // The assignment link is exported under the shared `tags_refs` table.
    expect(tables.tags_refs).toHaveLength(1);
    expect(result.totals.inserted).toBeGreaterThanOrEqual(3);

    const restoredContacts = await restoredDb
      .select({
        id: contacts.id,
        kind: contacts.kind,
        ownerId: contacts.ownerId,
        name: contacts.name,
        taxId: contacts.taxId,
      })
      .from(contacts)
      .all();
    expect(restoredContacts).toEqual([{
      id: "contact_supplier",
      kind: "organization",
      ownerId: "owner_1",
      name: "Supplier Co",
      taxId: "TAX-1",
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
