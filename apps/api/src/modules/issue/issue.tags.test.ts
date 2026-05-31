import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "@/db/schema";
import { listResourceIdsByAnyTag, listTagsWithUsage } from "@/modules/tag/tag.service";
import { createIssue, getIssueByShortId, issueTagBinding, listByProject, updateIssue } from "./issue.service";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

// Throwaway in-memory DB with FK enforcement intentionally left OFF, so tests
// can seed join rows directly and create issues against synthetic project /
// creator ids without standing up the full project / member / user graph.
async function bootDb() {
  const sqlite = new Database(":memory:");
  const db = Object.assign(drizzle(sqlite, { schema }), { close: () => sqlite.close() });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { sqlite, db };
}

describe("listResourceIdsByAnyTag (issue binding)", () => {
  it("returns the union of item ids carrying any of the given tags", async () => {
    const { sqlite, db } = await bootDb();
    sqlite.run(
      "INSERT INTO tags (id,name,type,created_at,updated_at) VALUES "
      + "('t1','alpha','issue','n','n'),('t2','beta','issue','n','n'),('t3','gamma','issue','n','n')",
    );
    // i1->t1 ; i2->t1,t2 ; i3->t3
    sqlite.run("INSERT INTO tags_refs (resource_id,tag_id) VALUES ('i1','t1'),('i2','t1'),('i2','t2'),('i3','t3')");

    // many tags by id → union (i1 has only t1, i2 has both): OR not AND
    const union = await listResourceIdsByAnyTag(db, issueTagBinding, ["t1", "t2"]);
    expect([...union].sort()).toEqual(["i1", "i2"]);

    // single tag resolved by name
    expect(await listResourceIdsByAnyTag(db, issueTagBinding, ["gamma"])).toEqual(["i3"]);

    // empty input → no ids
    expect(await listResourceIdsByAnyTag(db, issueTagBinding, [])).toEqual([]);

    // unresolvable value → no ids
    expect(await listResourceIdsByAnyTag(db, issueTagBinding, ["does-not-exist"])).toEqual([]);
  });

  it("lists the issue tag vocabulary with usage counts (GET /tags?type=issue)", async () => {
    const { sqlite, db } = await bootDb();
    sqlite.run(
      "INSERT INTO tags (id,name,type,created_at,updated_at) VALUES "
      + "('t1','alpha','issue','n','n'),('t2','beta','issue','n','n')",
    );
    sqlite.run("INSERT INTO tags_refs (resource_id,tag_id) VALUES ('i1','t1'),('i2','t1')");

    const vocab = await listTagsWithUsage(db, "issue");
    // most-used first, then by name: alpha(2) before beta(0)
    expect(vocab.map(v => [v.name, v.usageCount])).toEqual([["alpha", 2], ["beta", 0]]);
  });
});

describe("issue create/update tag association + list filter", () => {
  it("creates issues with tags, embeds them in rows, and filters OR/union", async () => {
    const { db } = await bootDb();
    await createIssue(db, { title: "A", projectId: "p1", creatorId: "u1", tags: ["alpha"] });
    await createIssue(db, { title: "B", projectId: "p1", creatorId: "u1", tags: ["beta", "alpha"] });
    await createIssue(db, { title: "C", projectId: "p1", creatorId: "u1", tags: ["gamma"] });

    // every row carries its tags
    const all = await listByProject(db, { projectId: "p1" });
    expect(all.total).toBe(3);
    expect(all.data.find(r => r.title === "A")!.tags.map(t => t.name)).toEqual(["alpha"]);
    expect(all.data.find(r => r.title === "B")!.tags.map(t => t.name).sort()).toEqual(["alpha", "beta"]);

    // 0 tags → no filter
    expect((await listByProject(db, { projectId: "p1", tagIds: [] })).total).toBe(3);

    // 1 tag → just that issue
    expect((await listByProject(db, { projectId: "p1", tagIds: ["gamma"] })).data.map(r => r.title)).toEqual(["C"]);

    // many tags → OR: alpha∪gamma = A,B,C (AND would be empty)
    expect((await listByProject(db, { projectId: "p1", tagIds: ["alpha", "gamma"] })).data.map(r => r.title).sort())
      .toEqual(["A", "B", "C"]);

    // AND-not-applied: alpha∪beta = A (alpha) and B (both); not just B
    expect((await listByProject(db, { projectId: "p1", tagIds: ["alpha", "beta"] })).data.map(r => r.title).sort())
      .toEqual(["A", "B"]);
  });

  it("update replaces the tag set, and omitting tags leaves them unchanged", async () => {
    const { db } = await bootDb();
    const a = await createIssue(db, { title: "A", projectId: "p1", creatorId: "u1", tags: ["alpha"] });

    await updateIssue(db, a.id, { tags: ["beta", "gamma"] });
    expect((await getIssueByShortId(db, a.id))!.tags.map(t => t.name).sort()).toEqual(["beta", "gamma"]);

    // a non-tag update must not touch tags
    await updateIssue(db, a.id, { title: "A2" });
    const after = await getIssueByShortId(db, a.id);
    expect(after!.title).toBe("A2");
    expect(after!.tags.map(t => t.name).sort()).toEqual(["beta", "gamma"]);

    // clearing with an empty array removes all tags
    await updateIssue(db, a.id, { tags: [] });
    expect((await getIssueByShortId(db, a.id))!.tags).toEqual([]);
  });
});
