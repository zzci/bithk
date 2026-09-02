import type { AppDatabase } from "@/db";
import type { AuditEvent } from "@/modules/audit/audit.service";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createVirtualUser } from "@/modules/account/users/users.service";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { appBaseUrl, buildNotificationMail } from "./consumers";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "notify-consumers-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedRealUser(email: string, status: "active" | "disabled" = "active"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `u-${id}`,
    name: `User ${id}`,
    email,
    role: "user",
    status,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "01EVENT",
    createdAt: "2026-09-01T00:00:00.000Z",
    actorId: "actor",
    actorName: "Alice",
    action: "noop",
    resourceType: "x",
    resourceId: "r1",
    resourceName: "Resource",
    ip: "127.0.0.1",
    userAgent: "test",
    result: "success",
    ...overrides,
  };
}

const config = { APP_URL: "https://oa.example.com/", BASE_PATH: "/app" };

describe("appBaseUrl", () => {
  test("joins APP_URL (trailing slash trimmed) and BASE_PATH", () => {
    expect(appBaseUrl(config)).toBe("https://oa.example.com/app");
    expect(appBaseUrl({ APP_URL: undefined, BASE_PATH: "" })).toBe("");
  });
});

describe("buildNotificationMail — share.created", () => {
  test("mails the recipient of a direct document share with a deep link", async () => {
    const recipient = await seedRealUser("bob@example.com");
    const mail = await buildNotificationMail(db, event({
      action: "share.created",
      resourceType: "share",
      resourceName: "Q3 plan",
      detail: { resourceType: "document", shareType: "direct", permission: "view", sharedWithUserId: recipient, resourceId: "doc12345" },
    }), config);
    expect(mail?.to).toBe("bob@example.com");
    expect(mail?.subject).toContain("Q3 plan");
    expect(mail?.text).toContain("https://oa.example.com/app/documents/doc12345");
    expect(mail?.text).toContain("Alice");
  });

  test("links a drive share to the drive root", async () => {
    const recipient = await seedRealUser("carol@example.com");
    const mail = await buildNotificationMail(db, event({
      action: "share.created",
      resourceName: "specs.pdf",
      detail: { resourceType: "drive_entry", shareType: "direct", permission: "download", sharedWithUserId: recipient, resourceId: "entry1" },
    }), config);
    expect(mail?.text).toContain("https://oa.example.com/app/drive");
  });

  test("ignores public links, virtual / disabled / email-less recipients, and failures", async () => {
    const virtual = await createVirtualUser(db, { username: "virt", name: "Virtual" });
    const disabled = await seedRealUser("off@example.com", "disabled");
    const noEmail = await seedRealUser("");
    const cases: Partial<AuditEvent>[] = [
      { action: "share.created", detail: { resourceType: "document", shareType: "public_link", resourceId: "d" } },
      { action: "share.created", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: virtual!.id, resourceId: "d" } },
      { action: "share.created", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: disabled, resourceId: "d" } },
      { action: "share.created", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: noEmail, resourceId: "d" } },
      { action: "share.created", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: "missing", resourceId: "d" } },
      { action: "share.created", result: "failure", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: disabled, resourceId: "d" } },
      { action: "share.updated", detail: { resourceType: "document", shareType: "direct", sharedWithUserId: disabled, resourceId: "d" } },
    ];
    for (const c of cases)
      expect(await buildNotificationMail(db, event(c), config)).toBeNull();
  });
});

describe("buildNotificationMail — issue.assigned", () => {
  test("mails the assigned internal member with the project-scoped work-order link", async () => {
    const owner = await seedRealUser("owner@example.com");
    const assignee = await seedRealUser("dave@example.com");
    const project = await createProject(db, { name: "Bridge", creatorId: owner });
    const readerRole = (await listRoles(db, project.id)).find(r => r.name === "Reader")!;
    const member = await addMember(db, project.id, { userId: assignee, roleId: readerRole.id });

    const mail = await buildNotificationMail(db, event({
      action: "issue.assigned",
      actorId: owner,
      actorName: "Owner",
      resourceType: "issue",
      resourceId: "iss12345",
      resourceName: "Fix the winch",
      detail: { from: null, to: member.id },
    }), config);
    expect(mail?.to).toBe("dave@example.com");
    expect(mail?.subject).toContain("Fix the winch");
    expect(mail?.text).toContain(`https://oa.example.com/app/projects/${project.shortId}/issues/iss12345`);
    expect(mail?.text).toContain("Bridge");
  });

  test("skips self-assignment, unassignment, unknown members and virtual assignees", async () => {
    const owner = await seedRealUser("owner2@example.com");
    const project = await createProject(db, { name: "Deck", creatorId: owner });
    const readerRole = (await listRoles(db, project.id)).find(r => r.name === "Reader")!;
    const virtual = await createVirtualUser(db, { username: "virt2", name: "Virtual Two" });
    const virtualMember = await addMember(db, project.id, { userId: virtual!.id, roleId: readerRole.id });
    const cases: Partial<AuditEvent>[] = [
      { action: "issue.assigned", actorId: owner, detail: { from: null, to: null } },
      { action: "issue.assigned", actorId: owner, detail: { from: null, to: "nope" } },
      { action: "issue.assigned", actorId: owner, detail: { from: null, to: virtualMember.id } },
    ];
    for (const c of cases)
      expect(await buildNotificationMail(db, event(c), config)).toBeNull();
  });
});
