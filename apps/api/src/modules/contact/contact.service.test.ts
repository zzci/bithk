import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createTuple } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { check } from "@/modules/policy/zanzibar.engine";
import { shares } from "@/modules/share/schema";
import { tagsRefs } from "@/modules/tag/schema";
import { createContactCategory } from "./contact-category.service";
import { resolveContactCapabilities } from "./contact.permission";
import * as contactService from "./contact.service";
import { contacts } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against the
// magic bytes, so a forged text payload would be rejected.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

function pngFile(name = "avatar.png"): File {
  return new File([PNG_1X1], name, { type: "image/png" });
}

function testConfig(): Config {
  return {
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_GC_MODE: "sync",
    FILE_PRESIGN_ENABLED: false,
    FILE_PRESIGN_TTL_SECONDS: 300,
  } as unknown as Config;
}

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  loadNamespaces();
  const dir = resolvePath(tmpdir(), `test-contact-service-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolvePath(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolvePath(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolvePath(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("contact service — kind model", () => {
  test("creating an individual stores person fields, kind, owner tuple, and sees all fields", async () => {
    const owner = await seedUser("owner-a");

    const view = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Alice Bond",
      phone: "123",
      email: "alice@example.test",
      position: "Procurement Lead",
      note: "Preferred",
      status: "active",
      visibility: "private",
      confidential: true,
      tags: ["supplier", "priority"],
    });

    expect(view.kind).toBe("individual");
    expect(view.ownerId).toBe(owner);
    expect(view.phone).toBe("123");
    expect(view.email).toBe("alice@example.test");
    expect(view.position).toBe("Procurement Lead");
    expect(view.note).toBe("Preferred");
    expect(view.status).toBe("active");
    expect(view.canManage).toBe(true);
    expect(view.tags.map(t => t.name).sort()).toEqual(["priority", "supplier"]);
    await expect(check(db, "contact", view.id, "owner", "user", owner)).resolves.toMatchObject({ allowed: true });
  });

  test("creating an organization stores company fields including the now-shared email and website", async () => {
    const owner = await seedUser("owner-a");

    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Oceanic Supplies",
      phone: "555",
      email: "info@oceanic.test",
      website: "oceanic.test",
      taxId: "TAX-1",
      address: "Dock 1",
    });

    expect(view.kind).toBe("organization");
    expect(view.taxId).toBe("TAX-1");
    expect(view.address).toBe("Dock 1");
    expect(view.phone).toBe("555");
    expect(view.email).toBe("info@oceanic.test");
    expect(view.website).toBe("oceanic.test");
    expect(view.position).toBeNull();
    expect(view.organizationId).toBeNull();
    expect(view.organization).toBeNull();
  });

  test("an individual accepts the now-shared website, address, and taxId", async () => {
    const owner = await seedUser("owner-a");

    const view = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Lee Park",
      phone: "777",
      email: "lee@example.test",
      website: "lee-park.test",
      address: "Pier 7",
      taxId: "IND-9",
      note: "Freelance surveyor",
    });

    expect(view.kind).toBe("individual");
    expect(view.website).toBe("lee-park.test");
    expect(view.address).toBe("Pier 7");
    expect(view.taxId).toBe("IND-9");
    expect(view.email).toBe("lee@example.test");
    expect(view.note).toBe("Freelance surveyor");
  });

  test("kind defaults to organization when omitted", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), { name: "Default Co" });
    expect(view.kind).toBe("organization");
  });

  test("organization rejects person-only and org-link fields; individual rejects nothing shared", async () => {
    const owner = await seedUser("owner-a");

    // taxId/address/email/website are now shared, so an individual accepts them.
    await expect(contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Fine Individual",
      taxId: "X",
      website: "x.test",
    })).resolves.toMatchObject({ kind: "individual", taxId: "X", website: "x.test" });

    // Organizations still reject position, organizationId, organizationName,
    // and organizationAttributes.
    await expect(contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Bad Org Position",
      position: "CEO",
    })).rejects.toMatchObject({ statusCode: 422 });

    await expect(contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Bad Org Link",
      organizationName: "Parent Co",
    })).rejects.toMatchObject({ statusCode: 422 });

    await expect(contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Bad Org Attrs",
      organizationAttributes: { website: "parent.test" },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test("list filters by kind", async () => {
    const owner = await seedUser("owner-a");
    const person = await contactService.create(db, actor(owner), { kind: "individual", name: "Person" });
    const org = await contactService.create(db, actor(owner), { kind: "organization", name: "Org" });

    expect((await contactService.list(db, actor(owner), { kind: "individual" })).data.map(c => c.id)).toEqual([person.id]);
    expect((await contactService.list(db, actor(owner), { kind: "organization" })).data.map(c => c.id)).toEqual([org.id]);
  });
});

describe("contact service — organization link (pick-or-create)", () => {
  test("links an individual to an existing organization and resolves its name", async () => {
    const owner = await seedUser("owner-a");
    const org = await contactService.create(db, actor(owner), { kind: "organization", name: "Oceanic Supplies" });

    const person = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Maria Chen",
      organizationId: org.id,
    });

    expect(person.organizationId).toBe(org.id);
    expect(person.organizationName).toBe("Oceanic Supplies");
  });

  test("creates a new organization inline from organizationName and links it", async () => {
    const owner = await seedUser("owner-a");

    const person = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Sam Vega",
      organizationName: "Fresh Org",
    });

    expect(person.organizationId).toBeTruthy();
    expect(person.organizationName).toBe("Fresh Org");
    const org = await db.select().from(contacts).where(eq(contacts.id, person.organizationId!)).get();
    expect(org?.kind).toBe("organization");
    expect(org?.name).toBe("Fresh Org");
    expect(org?.ownerId).toBe(owner);
  });

  test("creates a new organization inline carrying company fields from organizationAttributes", async () => {
    const owner = await seedUser("owner-a");

    const person = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Nadia Cole",
      organizationName: "Harbor Works",
      organizationAttributes: {
        website: "harbor-works.test",
        email: "hello@harbor-works.test",
        phone: "+1 555 0000",
        address: "Pier 9",
        taxId: "ORG-77",
      },
    });

    expect(person.organizationId).toBeTruthy();
    const org = await db.select().from(contacts).where(eq(contacts.id, person.organizationId!)).get();
    expect(org?.name).toBe("Harbor Works");
    expect(org?.website).toBe("harbor-works.test");
    expect(org?.email).toBe("hello@harbor-works.test");
    expect(org?.phone).toBe("+1 555 0000");
    expect(org?.address).toBe("Pier 9");
    expect(org?.taxId).toBe("ORG-77");

    // The individual's read carries the embedded organization summary.
    expect(person.organization).toMatchObject({
      id: org!.id,
      name: "Harbor Works",
      website: "harbor-works.test",
      email: "hello@harbor-works.test",
      phone: "+1 555 0000",
      address: "Pier 9",
      taxId: "ORG-77",
    });
  });

  test("rejects an organizationId that is not an organization", async () => {
    const owner = await seedUser("owner-a");
    const otherPerson = await contactService.create(db, actor(owner), { kind: "individual", name: "Not An Org" });

    await expect(contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Bad Link",
      organizationId: otherPerson.id,
    })).rejects.toMatchObject({ statusCode: 422 });

    await expect(contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Bad Link 2",
      organizationId: "no-such-org",
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test("update can change, create, and clear an individual's organization link", async () => {
    const owner = await seedUser("owner-a");
    const orgA = await contactService.create(db, actor(owner), { kind: "organization", name: "Org A" });
    const person = await contactService.create(db, actor(owner), { kind: "individual", name: "Linker", organizationId: orgA.id });
    expect(person.organizationId).toBe(orgA.id);

    // Create + link a fresh org inline.
    const relinked = await contactService.update(db, actor(owner), person.id, { organizationName: "Org B" });
    expect(relinked.organizationName).toBe("Org B");
    expect(relinked.organizationId).not.toBe(orgA.id);

    // Clear it.
    const cleared = await contactService.update(db, actor(owner), person.id, { organizationId: null });
    expect(cleared.organizationId).toBeNull();
    expect(cleared.organizationName).toBeNull();
  });

  test("kind is immutable on update", async () => {
    const owner = await seedUser("owner-a");
    const person = await contactService.create(db, actor(owner), { kind: "individual", name: "Fixed Kind" });

    await expect(contactService.update(db, actor(owner), person.id, { kind: "organization" }))
      .rejects
      .toMatchObject({ statusCode: 422 });
  });

  test("update rejects person-only fields against a stored organization", async () => {
    const owner = await seedUser("owner-a");
    const org = await contactService.create(db, actor(owner), { kind: "organization", name: "Org" });

    // email is now shared, so it is accepted on an organization update.
    await expect(contactService.update(db, actor(owner), org.id, { email: "x@example.test" }))
      .resolves
      .toMatchObject({ email: "x@example.test" });

    // position is still individual-only and rejected on an organization.
    await expect(contactService.update(db, actor(owner), org.id, { position: "CEO" }))
      .rejects
      .toMatchObject({ statusCode: 422 });
  });
});

describe("contact service — attributes", () => {
  test("stores a flat string map and returns it parsed", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Attr Co",
      attributes: { website: "example.test", terms: "Net 30" },
    });
    expect(view.attributes).toEqual({ website: "example.test", terms: "Net 30" });

    const cleared = await contactService.update(db, actor(owner), view.id, { attributes: null });
    expect(cleared.attributes).toBeNull();
  });

  test("rejects nested objects and non-string values", async () => {
    const owner = await seedUser("owner-a");

    await expect(contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Nested",
      attributes: { bad: { deep: "x" } } as unknown as Record<string, string>,
    })).rejects.toMatchObject({ statusCode: 422 });

    await expect(contactService.create(db, actor(owner), {
      kind: "organization",
      name: "NonString",
      attributes: { n: 5 } as unknown as Record<string, string>,
    })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("contact service — avatar", () => {
  test("set then remove exposes and clears the avatar url", async () => {
    const owner = await seedUser("owner-a");
    const contact = await contactService.create(db, actor(owner), { kind: "organization", name: "Logo Co" });
    expect(contact.avatarUrl).toBeNull();

    const withAvatar = await contactService.setAvatar(db, actor(owner), contact.id, pngFile(), testConfig());
    expect(withAvatar.avatarReferenceId).toBeTruthy();
    expect(withAvatar.avatarUrl).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);

    const cleared = await contactService.removeAvatar(db, actor(owner), contact.id, testConfig());
    expect(cleared.avatarReferenceId).toBeNull();
    expect(cleared.avatarUrl).toBeNull();
  });

  test("replacing an avatar swaps the reference", async () => {
    const owner = await seedUser("owner-a");
    const contact = await contactService.create(db, actor(owner), { kind: "individual", name: "Avatar Person" });
    const first = await contactService.setAvatar(db, actor(owner), contact.id, pngFile("a.png"), testConfig());
    const other = new File([Uint8Array.from([...PNG_1X1, 3, 2, 1])], "b.png", { type: "image/png" });
    const second = await contactService.setAvatar(db, actor(owner), contact.id, other, testConfig());

    expect(second.avatarReferenceId).toBeTruthy();
    expect(second.avatarReferenceId).not.toBe(first.avatarReferenceId);
  });

  test("delete releases the avatar reference", async () => {
    const owner = await seedUser("owner-a");
    const contact = await contactService.create(db, actor(owner), { kind: "organization", name: "Doomed Co" });
    await contactService.setAvatar(db, actor(owner), contact.id, pngFile(), testConfig());

    await contactService.delete(db, actor(owner), contact.id, testConfig());
    await expect(contactService.resolve(db, contact.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("contact service — access and masking", () => {
  test("private contacts are invisible to strangers", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const view = await contactService.create(db, actor(owner), { kind: "organization", name: "Private Co", visibility: "private" });

    expect((await contactService.list(db, actor(stranger))).data).toEqual([]);
    await expect(contactService.get(db, actor(stranger), view.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("public contacts are visible to any user without manage capability", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Public Co",
      phone: "123",
      visibility: "public",
    });

    const fetched = await contactService.get(db, actor(stranger), view.id);
    expect(fetched.name).toBe("Public Co");
    expect(fetched.phone).toBe("123");
    expect(fetched.canManage).toBe(false);
    expect((await contactService.list(db, actor(stranger))).data.map(c => c.id)).toEqual([view.id]);
  });

  test("explicit per-user viewer grant allows a stranger to read", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Granted Co",
      email: "granted@example.test",
      visibility: "private",
    });

    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    const fetched = await contactService.get(db, actor(viewer), view.id);
    expect(fetched.email).toBe("granted@example.test");
    expect(fetched.canManage).toBe(false);
  });

  test("explicit per-group viewer grant allows group members to read", async () => {
    const owner = await seedUser("owner-a");
    const member = await seedUser("member-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Group Co",
      phone: "456",
      visibility: "private",
    });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: member,
    }, owner);

    await contactService.grant(db, actor(owner), view.id, { type: "group", id: "group-a" });

    const fetched = await contactService.get(db, actor(member), view.id);
    expect(fetched.phone).toBe("456");
    expect((await contactService.list(db, actor(member))).data.map(c => c.id)).toEqual([view.id]);
  });

  test("confidential public contacts mask fields for implicit readers but not explicit viewers, owners, or admins", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const explicitViewer = await seedUser("viewer-a");
    const admin = await seedUser("admin-a", "admin");
    const view = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Secret Co",
      phone: "123",
      email: "secret@example.test",
      position: "Hidden Role",
      note: "Sensitive",
      status: "inactive",
      visibility: "public",
      confidential: true,
      tags: ["confidential"],
    });
    await forcePublicConfidential(view.id);

    const masked = await contactService.get(db, actor(stranger), view.id);
    expect(masked.name).toBe("Secret Co");
    expect(masked.kind).toBe("individual");
    expect(masked.tags.map(t => t.name)).toEqual(["confidential"]);
    expect(masked.phone).toBeNull();
    expect(masked.email).toBeNull();
    expect(masked.position).toBeNull();
    expect(masked.note).toBeNull();
    expect(masked.status).toBeNull();

    await contactService.grant(db, actor(owner), view.id, { type: "user", id: explicitViewer });

    await expect(contactService.get(db, actor(explicitViewer), view.id)).resolves.toMatchObject({
      email: "secret@example.test",
      status: "inactive",
    });
    await expect(contactService.get(db, actor(owner), view.id)).resolves.toMatchObject({ email: "secret@example.test" });
    await expect(contactService.get(db, actor(admin, "admin"), view.id)).resolves.toMatchObject({ email: "secret@example.test" });
  });

  test("website is masked alongside the other detail fields on confidential public reads", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Webby Co",
      website: "webby.test",
      visibility: "public",
      confidential: true,
    });
    await forcePublicConfidential(view.id);

    const masked = await contactService.get(db, actor(stranger), view.id);
    expect(masked.name).toBe("Webby Co");
    expect(masked.website).toBeNull();

    // The owner is never masked on its own row.
    await expect(contactService.get(db, actor(owner), view.id)).resolves.toMatchObject({ website: "webby.test" });
  });

  test("embedded organization summary respects the org's own confidential masking, keeping name", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");

    // The employer org is public + confidential, so its sensitive fields are
    // masked to implicit readers.
    const org = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Confidential Employer",
      website: "employer.test",
      email: "info@employer.test",
      phone: "999",
      address: "HQ Tower",
      taxId: "EMP-1",
      visibility: "public",
      confidential: true,
    });
    await forcePublicConfidential(org.id);
    // The person is public + non-confidential, so a stranger can read them.
    const person = await contactService.create(db, actor(owner), {
      kind: "individual",
      name: "Public Person",
      organizationId: org.id,
      visibility: "public",
    });

    // Stranger read: person fields visible, embedded org summary sensitive
    // fields nulled by the org's own masking, name retained.
    const strangerView = await contactService.get(db, actor(stranger), person.id);
    expect(strangerView.organizationId).toBe(org.id);
    expect(strangerView.organization).toEqual({
      id: org.id,
      name: "Confidential Employer",
      website: null,
      email: null,
      phone: null,
      address: null,
      taxId: null,
    });

    // Owner read: full org summary.
    const ownerView = await contactService.get(db, actor(owner), person.id);
    expect(ownerView.organization).toEqual({
      id: org.id,
      name: "Confidential Employer",
      website: "employer.test",
      email: "info@employer.test",
      phone: "999",
      address: "HQ Tower",
      taxId: "EMP-1",
    });
  });

  test("tags attach, resync on update, and list filters by a multi-tag union", async () => {
    const owner = await seedUser("owner-a");
    const supplier = await contactService.create(db, actor(owner), { kind: "organization", name: "Supplier", tags: ["supplier", "priority"] });
    const client = await contactService.create(db, actor(owner), { kind: "organization", name: "Client", tags: ["client"] });

    expect((await contactService.list(db, actor(owner), { tagIds: ["supplier"] })).data.map(c => c.id)).toEqual([supplier.id]);
    expect((await contactService.list(db, actor(owner), { tagIds: ["client"] })).data.map(c => c.id)).toEqual([client.id]);
    // union: a row carrying ANY selected tag matches.
    expect((await contactService.list(db, actor(owner), { tagIds: ["supplier", "client"] })).data.map(c => c.id).sort())
      .toEqual([client.id, supplier.id].sort());

    const updated = await contactService.update(db, actor(owner), supplier.id, {
      name: "Supplier Updated",
      tags: ["client"],
    });
    expect(updated.name).toBe("Supplier Updated");
    expect(updated.tags.map(t => t.name)).toEqual(["client"]);
    expect((await contactService.list(db, actor(owner), { tagIds: ["supplier"] })).data.map(c => c.id)).toEqual([]);
    expect((await contactService.list(db, actor(owner), { tagIds: ["client"] })).data.map(c => c.id).sort()).toEqual([client.id, supplier.id].sort());
  });

  test("revoke removes explicit access", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), { kind: "organization", name: "Revoked Co", visibility: "private" });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    await expect(contactService.get(db, actor(viewer), view.id)).resolves.toMatchObject({ id: view.id });
    expect(await contactService.revoke(db, actor(owner), view.id, { type: "user", id: viewer })).toBe(true);

    expect((await contactService.list(db, actor(viewer))).data).toEqual([]);
    await expect(contactService.get(db, actor(viewer), view.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("delete removes the row, tag links, and policy tuples", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), { kind: "organization", name: "Deleted Co", tags: ["supplier"] });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    await contactService.delete(db, actor(owner), view.id, testConfig());

    await expect(contactService.resolve(db, view.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, view.id)).all()).toEqual([]);
    expect(await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "contact"),
      eq(relationTuples.objectId, view.id),
    )).all()).toEqual([]);
  });

  test("delete clears the row, tag links, tuples, and token-based shares in one atomic step", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), { kind: "organization", name: "Shared Co", tags: ["supplier"] });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: owner });
    // A polymorphic token-based share row (no FK on `resource_id`).
    await db.insert(shares).values({
      id: nanoid(),
      resourceType: "contact" as never,
      resourceId: view.id,
      token: `tok-${view.id}`,
      createdBy: owner,
    }).run();

    await contactService.delete(db, actor(owner), view.id, testConfig());

    await expect(contactService.resolve(db, view.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, view.id)).all()).toEqual([]);
    expect(await db.select().from(relationTuples).where(eq(relationTuples.objectId, view.id)).all()).toEqual([]);
    expect(await db.select().from(shares).where(eq(shares.resourceId, view.id)).all()).toEqual([]);
  });

  test("deleting an organization clears its members' organization link", async () => {
    const owner = await seedUser("owner-a");
    const org = await contactService.create(db, actor(owner), { kind: "organization", name: "Parent Org" });
    const person = await contactService.create(db, actor(owner), { kind: "individual", name: "Member", organizationId: org.id });

    await contactService.delete(db, actor(owner), org.id, testConfig());

    const refreshed = await contactService.get(db, actor(owner), person.id);
    expect(refreshed.organizationId).toBeNull();
    expect(refreshed.organizationName).toBeNull();
  });

  test("deleting a missing contact throws and touches nothing", async () => {
    const owner = await seedUser("owner-a");
    const keep = await contactService.create(db, actor(owner), { kind: "organization", name: "Keep Co", tags: ["supplier"] });

    await expect(contactService.delete(db, actor(owner), "no-such-contact", testConfig()))
      .rejects
      .toMatchObject({ statusCode: 404 });

    // The unrelated contact's tag links remain intact (no stray cleanup ran).
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, keep.id)).all()).toHaveLength(1);
  });

  test("q matches name or note", async () => {
    const owner = await seedUser("owner-a");
    const byName = await contactService.create(db, actor(owner), { kind: "organization", name: "Acme Industries" });
    const byNote = await contactService.create(db, actor(owner), { kind: "organization", name: "Third Co", note: "an acme supplier" });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Unrelated" });

    const hits = await contactService.list(db, actor(owner), { q: "acme" });
    expect(hits.data.map(c => c.id).sort()).toEqual([byName.id, byNote.id].sort());
    expect(hits.total).toBe(2);
  });

  test("non-privileged q cannot probe masked confidential fields but privileged search still matches", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const explicitViewer = await seedUser("viewer-a");
    const admin = await seedUser("admin-a", "admin");
    const secret = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Visible Name",
      note: "secret-note",
      visibility: "public",
      confidential: true,
    });
    await forcePublicConfidential(secret.id);

    // A stranger sees the row (public) but its confidential note is masked,
    // so searching it must yield no hit — closing the oracle.
    expect((await contactService.list(db, actor(stranger), { q: "secret-note" })).data).toEqual([]);
    // The always-visible `name` stays searchable.
    expect((await contactService.list(db, actor(stranger), { q: "Visible" })).data.map(c => c.id)).toEqual([secret.id]);

    // Owner and admin see the fields, so their search still matches them.
    expect((await contactService.list(db, actor(owner), { q: "secret-note" })).data.map(c => c.id)).toEqual([secret.id]);
    expect((await contactService.list(db, actor(admin, "admin"), { q: "secret-note" })).data.map(c => c.id)).toEqual([secret.id]);

    // An explicit viewer is un-masked, so its confidential-field search matches too.
    await contactService.grant(db, actor(owner), secret.id, { type: "user", id: explicitViewer });
    expect((await contactService.list(db, actor(explicitViewer), { q: "secret-note" })).data.map(c => c.id)).toEqual([secret.id]);
  });

  test("non-confidential public contacts stay fully searchable by strangers", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const open = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Open Co",
      note: "PublicNote",
      visibility: "public",
      confidential: false,
    });

    // Fields are visible here, so matching on note is not an oracle.
    expect((await contactService.list(db, actor(stranger), { q: "PublicNote" })).data.map(c => c.id)).toEqual([open.id]);
  });

  test("q escapes LIKE wildcards so they match literally", async () => {
    const owner = await seedUser("owner-a");
    const literal = await contactService.create(db, actor(owner), { kind: "organization", name: "50% discount" });
    await contactService.create(db, actor(owner), { kind: "organization", name: "plain name" });

    // Without escaping, '%' would match every row; escaped it matches only the literal.
    const hits = await contactService.list(db, actor(owner), { q: "50%" });
    expect(hits.data.map(c => c.id)).toEqual([literal.id]);
  });

  test("status filter narrows by contact status", async () => {
    const owner = await seedUser("owner-a");
    const active = await contactService.create(db, actor(owner), { kind: "organization", name: "Active Co", status: "active" });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Inactive Co", status: "inactive" });

    const hits = await contactService.list(db, actor(owner), { status: "active" });
    expect(hits.data.map(c => c.id)).toEqual([active.id]);
  });

  test("categoryId filter narrows by category", async () => {
    const owner = await seedUser("owner-a");
    const supplierCat = await createContactCategory(db, { name: "Suppliers" });
    const clientCat = await createContactCategory(db, { name: "Clients" });
    const supplier = await contactService.create(db, actor(owner), { kind: "organization", name: "Supplier Co", categoryId: supplierCat.id });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Client Co", categoryId: clientCat.id });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Uncategorized Co" });

    const hits = await contactService.list(db, actor(owner), { categoryId: supplierCat.id });
    expect(hits.data.map(c => c.id)).toEqual([supplier.id]);
  });

  test("visibility and confidential are no longer user-facing list filters but masking stays intact", async () => {
    const owner = await seedUser("owner-a");
    await contactService.create(db, actor(owner), { kind: "organization", name: "Private Co", visibility: "private" });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Public Co", visibility: "public", confidential: true });

    // The owner always sees its own rows; no visibility/confidential filter prunes them.
    const all = await contactService.list(db, actor(owner));
    expect(all.data.map(c => c.name).sort()).toEqual(["Private Co", "Public Co"]);
    // The owner is never masked on its own confidential contact.
    const secret = all.data.find(c => c.name === "Public Co")!;
    expect(secret.confidential).toBe(true);
  });

  test("pagination slices rows and reports the full total", async () => {
    const owner = await seedUser("owner-a");
    for (let i = 0; i < 5; i++)
      await contactService.create(db, actor(owner), { kind: "organization", name: `Co ${i}` });

    const page1 = await contactService.list(db, actor(owner), { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page3 = await contactService.list(db, actor(owner), { page: 3, limit: 2 });
    expect(page3.data).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  test("omitting page returns the full set with total = row count", async () => {
    const owner = await seedUser("owner-a");
    for (let i = 0; i < 3; i++)
      await contactService.create(db, actor(owner), { kind: "organization", name: `Co ${i}` });

    const all = await contactService.list(db, actor(owner));
    expect(all.data).toHaveLength(3);
    expect(all.total).toBe(3);
  });
});

describe("contact service — batched list capability resolution", () => {
  // Equality oracle for the batched list path: the per-row resolution
  // (`resolveContactCapabilities` + `compose`, still used by the detail path)
  // applied to every row in list order must produce the exact same output the
  // batched `list` returns — same rows kept, same masking on every field.
  test("list output equals the per-row resolution for a mixed-visibility fixture", async () => {
    const owner = await seedUser("owner-a");
    const reader = await seedUser("reader-a");
    const admin = await seedUser("admin-a", "admin");

    await contactService.create(db, actor(owner), { kind: "organization", name: "Public Co", phone: "111", visibility: "public" });
    const pubConf = await contactService.create(db, actor(owner), { kind: "organization", name: "Masked Co", phone: "222", note: "masked", visibility: "public", confidential: true });
    await forcePublicConfidential(pubConf.id);
    const granted = await contactService.create(db, actor(owner), { kind: "organization", name: "Granted Co", phone: "333", visibility: "private" });
    await contactService.grant(db, actor(owner), granted.id, { type: "user", id: reader });
    const groupGranted = await contactService.create(db, actor(owner), { kind: "organization", name: "Group Co", phone: "444", visibility: "private" });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: reader,
    }, owner);
    await contactService.grant(db, actor(owner), groupGranted.id, { type: "group", id: "group-a" });
    await contactService.create(db, actor(owner), { kind: "organization", name: "Hidden Co", visibility: "private" });
    await contactService.create(db, actor(reader), { kind: "organization", name: "Mine Co", visibility: "private", tags: ["own"] });
    // A public individual whose employer org is private but viewer-granted to
    // the reader — exercises the batched org-summary masking path.
    await contactService.create(db, actor(owner), { kind: "individual", name: "Linked Person", visibility: "public", organizationId: granted.id });

    for (const a of [actor(reader), actor(owner), actor(admin, "admin")]) {
      const { data, total } = await contactService.list(db, a);

      const rows = await db.select().from(contacts).orderBy(desc(contacts.createdAt), desc(contacts.id)).all();
      const expected = [];
      for (const row of rows) {
        const caps = await resolveContactCapabilities(db, row, a);
        if (caps.size === 0)
          continue;
        expected.push(await contactService.compose(db, a, row));
      }

      expect(data).toEqual(expected);
      expect(total).toBe(expected.length);
    }
  });
});

describe("contact service — sensitivity invariant and filter", () => {
  test("create coerces visibility to private when confidential is true", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Coerced Co",
      visibility: "public",
      confidential: true,
    });

    expect(view.confidential).toBe(true);
    expect(view.visibility).toBe("private");
    const row = await db.select().from(contacts).where(eq(contacts.id, view.id)).get();
    expect(row?.visibility).toBe("private");
    expect(row?.confidential).toBe(true);
  });

  test("update setting confidential=true on a public row coerces visibility to private", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Going Confidential",
      visibility: "public",
      confidential: false,
    });
    expect(view.visibility).toBe("public");

    const updated = await contactService.update(db, actor(owner), view.id, { confidential: true });
    expect(updated.confidential).toBe(true);
    expect(updated.visibility).toBe("private");
  });

  test("update setting visibility=public on an already-confidential row keeps visibility private", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), {
      kind: "organization",
      name: "Stays Private",
      confidential: true,
    });
    expect(view.visibility).toBe("private");
    expect(view.confidential).toBe(true);

    // confidential is unchanged here, but the stored value still forces private.
    const updated = await contactService.update(db, actor(owner), view.id, { visibility: "public" });
    expect(updated.visibility).toBe("private");
    expect(updated.confidential).toBe(true);
  });

  test("list filters by the derived sensitivity (public / private / confidential)", async () => {
    const admin = await seedUser("admin-a", "admin");
    const pub = await contactService.create(db, actor(admin, "admin"), { kind: "organization", name: "Public Co", visibility: "public", confidential: false });
    const priv = await contactService.create(db, actor(admin, "admin"), { kind: "organization", name: "Private Co", visibility: "private", confidential: false });
    const conf = await contactService.create(db, actor(admin, "admin"), { kind: "organization", name: "Confidential Co", confidential: true });

    expect((await contactService.list(db, actor(admin, "admin"), { sensitivity: "public" })).data.map(c => c.id)).toEqual([pub.id]);
    expect((await contactService.list(db, actor(admin, "admin"), { sensitivity: "private" })).data.map(c => c.id)).toEqual([priv.id]);
    expect((await contactService.list(db, actor(admin, "admin"), { sensitivity: "confidential" })).data.map(c => c.id)).toEqual([conf.id]);
  });
});

async function seedUser(id: string, role: "admin" | "user" = "user"): Promise<string> {
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@test.local`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function actor(id: string, role: "admin" | "user" = "user") {
  return { id, role };
}

// The sensitivity invariant refuses public+confidential at the service layer.
// Stamp that masking-relevant state directly onto an already-created row (which
// still went through the real service for its tuple/tags/fields) so the masking
// code — untouched by this change — stays exercised. Mirrors a legacy/migrated
// row the masking path still defensively handles.
async function forcePublicConfidential(id: string): Promise<void> {
  await db.update(contacts).set({ visibility: "public", confidential: true }).where(eq(contacts.id, id)).run();
}
