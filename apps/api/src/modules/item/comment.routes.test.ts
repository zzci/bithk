import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { CommentSubject } from "@/modules/item/comment.routes";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { mountItemCommentRoutes } from "@/modules/item/comment.routes";
import { createItem } from "@/modules/item/item.service";
import { errorHandler } from "@/shared/middleware/error-handler";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

// The four sub-types that mount the shared comment factory. Behaviour is
// uniform across them, so the matrix is run against every parent.
const PARENTS = ["document", "drive", "issue", "procurement"] as const;

const MEMBER = { id: "member", role: "user", name: "Member" };
const OTHER_MEMBER = { id: "other-member", role: "user", name: "Other" };
const NON_MEMBER = { id: "non-member", role: "user", name: "Outsider" };

let db: AppDatabase;
let dbPath: string;
let externalId: string;
let itemId: string;

function config(): Config {
  return {
    MAX_UPLOAD_BYTES: 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
  } as Config;
}

/**
 * Build an app mounting the comment factory for every parent type. The acting
 * user is chosen by the `x-test-user` header so a single app exercises member
 * vs non-member without re-mounting. `permissions` mirrors the real sub-types:
 * `canRead` is the membership/visibility gate; a non-member reads false.
 */
function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", config());
    c.set("logger", stubLogger);
    const who = c.req.header("x-test-user") ?? "non-member";
    const user = who === "member" ? MEMBER : who === "other-member" ? OTHER_MEMBER : NON_MEMBER;
    // The factory only reads id/role/name; a partial actor is sufficient.
    c.set("user", user as unknown as User);
    await next();
  });

  for (const parent of PARENTS) {
    mountItemCommentRoutes(app, {
      routePrefix: `/${parent}s`,
      resourceType: parent,
      async resolve(_db, idParam): Promise<CommentSubject | null> {
        if (idParam !== externalId)
          return null;
        const item = { id: itemId } as CommentSubject["item"];
        return { item, resource: {}, externalId, resourceName: `${parent} subject` };
      },
      async permissions(_db, user) {
        const isMember = user.id === MEMBER.id || user.id === OTHER_MEMBER.id || user.role === "admin";
        return {
          canRead: isMember,
          canPost: isMember,
          includeInternal: isMember,
          canDelete: authorId => user.role === "admin" || authorId === user.id,
        };
      },
    });
  }

  app.onError(errorHandler);
  return app;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-comment-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  await db.insert(users).values({
    id: MEMBER.id,
    oauthSub: "sub-member",
    username: "member",
    name: "Member",
    email: "member@test.com",
  }).run();
  const item = await createItem(db, { type: "issue", title: "Subject", status: "open", creatorId: MEMBER.id });
  itemId = item.id;
  externalId = nanoid();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

function req(app: Hono<AppEnv>, method: string, path: string, user: string, body?: unknown) {
  const headers: Record<string, string> = { "x-test-user": user };
  if (body !== undefined)
    headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("shared comment routes — existence-leak hardening", () => {
  for (const parent of PARENTS) {
    describe(`${parent} parent`, () => {
      const base = () => `/${parent}s/${externalId}/comments`;

      test("non-member gets 404 (not 403) on list", async () => {
        const res = await req(buildApp(), "GET", base(), "non-member");
        expect(res.status).toBe(404);
        const body = await res.json() as { success: boolean; error?: unknown };
        expect(body.success).toBe(false);
        expect(body.error).toBeDefined();
      });

      test("non-member gets 404 (not 403) on create", async () => {
        const res = await req(buildApp(), "POST", base(), "non-member", { content: "hi" });
        expect(res.status).toBe(404);
        expect((await res.json() as { success: boolean }).success).toBe(false);
      });

      test("non-member gets 404 (not 403) on delete", async () => {
        const res = await req(buildApp(), "DELETE", `${base()}/some-cid`, "non-member");
        expect(res.status).toBe(404);
        expect((await res.json() as { success: boolean }).success).toBe(false);
      });

      test("non-member gets 404 on attachment list (no comment-existence leak)", async () => {
        const res = await req(buildApp(), "GET", `${base()}/some-cid/attachments`, "non-member");
        expect(res.status).toBe(404);
      });

      test("member retains access: list 200, create 201, delete own 200", async () => {
        const app = buildApp();
        const list = await req(app, "GET", base(), "member");
        expect(list.status).toBe(200);
        expect((await list.json() as { success: boolean }).success).toBe(true);

        const created = await req(app, "POST", base(), "member", { content: "hello" });
        expect(created.status).toBe(201);
        const cid = (await created.json() as { data: { id: string } }).data.id;

        const del = await req(app, "DELETE", `${base()}/${cid}`, "member");
        expect(del.status).toBe(200);
      });

      test("a reader who is not the author gets 403 (not 404) on delete", async () => {
        const app = buildApp();
        const created = await req(app, "POST", base(), "member", { content: "owned by member" });
        const cid = (await created.json() as { data: { id: string } }).data.id;

        // other-member CAN read the subject, so the existence is not hidden;
        // the author-only delete rule denies with 403.
        const del = await req(app, "DELETE", `${base()}/${cid}`, "other-member");
        expect(del.status).toBe(403);
      });

      test("missing subject still 404s for a member (real not-found path)", async () => {
        const res = await req(buildApp(), "GET", `/${parent}s/does-not-exist/comments`, "member");
        expect(res.status).toBe(404);
      });
    });
  }
});
