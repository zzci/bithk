import type { ContactAccessActor, ContactCapability } from "./contact.permission";
import type { ContactStatus, ContactVisibility } from "./schema";
import type { AppDatabase, RunResult } from "@/db";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createTuple, deleteTupleByKey } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { check, listUserResources } from "@/modules/policy/zanzibar.engine";
import { shares } from "@/modules/share/schema";
import { tagsRefs } from "@/modules/tag/schema";
import { listResourceIdsByAnyTag, listResourceTagViews, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { NotFoundError, ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import {
  assertContactCapability,
  canSeeConfidentialFields,
  resolveContactCapabilities,
} from "./contact.permission";
import { contacts } from "./schema";

/** Contact tag binding (tag type='contact'), passed to the shared tag helpers. */
const CONTACT_TAG_BINDING = {
  type: "contact",
} as const;

export type ContactRow = typeof contacts.$inferSelect;

export interface ContactTagView {
  readonly id: string;
  readonly name: string;
}

export interface ContactView {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly contactPerson: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly note: string | null;
  readonly categoryId: string | null;
  readonly status: ContactStatus | null;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly tags: readonly ContactTagView[];
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateContactInput {
  readonly name: string;
  readonly contactPerson?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface UpdateContactInput {
  readonly name?: string | undefined;
  readonly contactPerson?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface ListContactsParams {
  readonly tagIds?: readonly string[] | undefined;
  readonly categoryId?: string | undefined;
  readonly q?: string | undefined;
  readonly status?: ContactStatus | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ListContactsResult {
  readonly data: readonly ContactView[];
  readonly total: number;
}

const LIKE_SPECIAL_RE = /[\\%_]/g;

/** Backslash-escape SQL LIKE wildcards so user input is matched literally. */
function escapeLike(v: string): string {
  return v.replace(LIKE_SPECIAL_RE, "\\$&");
}

export interface ContactGrantTarget {
  readonly type: "user" | "group";
  readonly id: string;
}

export async function create(
  db: AppDatabase,
  actor: ContactAccessActor,
  input: CreateContactInput,
): Promise<ContactView> {
  const id = nanoid();
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(contacts).values({
      id,
      ownerId: actor.id,
      name: input.name,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      taxId: input.taxId ?? null,
      note: input.note ?? null,
      categoryId: input.categoryId ?? null,
      status: input.status ?? "active",
      visibility: input.visibility ?? "private",
      confidential: input.confidential ?? false,
      createdAt: now,
      updatedAt: now,
    }).run();

    tx.insert(relationTuples).values({
      id: nanoid(),
      namespace: "contact",
      objectId: id,
      relation: "owner",
      subjectNamespace: "user",
      subjectId: actor.id,
      subjectRelation: null,
      createdBy: actor.id,
      createdAt: now,
    }).run();

    syncResourceTagsTx(tx, CONTACT_TAG_BINDING, id, input.tags ?? [], now);
  });

  return compose(db, actor, (await db.select().from(contacts).where(eq(contacts.id, id)).get())!);
}

export async function get(db: AppDatabase, actor: ContactAccessActor, id: string): Promise<ContactView> {
  const row = await assertContactCapability(db, actor, id, "read");
  return compose(db, actor, row);
}

export async function list(
  db: AppDatabase,
  actor: ContactAccessActor,
  params: ListContactsParams = {},
): Promise<ListContactsResult> {
  const conditions = [];

  if (actor.role !== "admin") {
    const explicitIds = await listUserResources(db, actor.id, "contact", "viewer");
    const access = [
      eq(contacts.ownerId, actor.id),
      eq(contacts.visibility, "public" as const),
    ];
    if (explicitIds.length > 0)
      access.push(inArray(contacts.id, [...explicitIds]));
    conditions.push(or(...access)!);
  }

  // Multi-tag filter: union of contact ids carrying any of the selected tags.
  if (params.tagIds && params.tagIds.length > 0) {
    const ids = await listResourceIdsByAnyTag(db, CONTACT_TAG_BINDING, params.tagIds);
    if (ids.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(contacts.id, ids));
  }

  if (params.categoryId)
    conditions.push(eq(contacts.categoryId, params.categoryId));
  if (params.status)
    conditions.push(eq(contacts.status, params.status));
  if (params.q && params.q.length > 0) {
    const like = `%${escapeLike(params.q)}%`;
    conditions.push(sql`(${contacts.name} LIKE ${like} ESCAPE '\\' OR ${contacts.contactPerson} LIKE ${like} ESCAPE '\\' OR ${contacts.note} LIKE ${like} ESCAPE '\\')`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const paginate = params.page !== undefined;
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  let total: number;
  if (paginate) {
    const totalRow = await db.select({ value: count() }).from(contacts).where(where).get();
    total = totalRow?.value ?? 0;
  }

  const baseQuery = db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.createdAt), desc(contacts.id));
  const rows = paginate
    ? await baseQuery.limit(limit).offset((page - 1) * limit).all()
    : await baseQuery.all();

  const views: ContactView[] = [];
  for (const row of rows) {
    const caps = await resolveContactCapabilities(db, row, actor);
    if (caps.size === 0)
      continue;
    views.push(await composeWithCapabilities(db, actor, row, caps));
  }
  return { data: views, total: paginate ? total! : views.length };
}

export async function update(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  input: UpdateContactInput,
): Promise<ContactView> {
  await assertContactCapability(db, actor, id, "update");

  const now = new Date().toISOString();
  db.transaction((tx) => {
    const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined)
      patch.name = input.name;
    if (input.contactPerson !== undefined)
      patch.contactPerson = input.contactPerson;
    if (input.phone !== undefined)
      patch.phone = input.phone;
    if (input.email !== undefined)
      patch.email = input.email;
    if (input.address !== undefined)
      patch.address = input.address;
    if (input.taxId !== undefined)
      patch.taxId = input.taxId;
    if (input.note !== undefined)
      patch.note = input.note;
    if (input.categoryId !== undefined)
      patch.categoryId = input.categoryId;
    if (input.status !== undefined)
      patch.status = input.status;
    if (input.visibility !== undefined)
      patch.visibility = input.visibility;
    if (input.confidential !== undefined)
      patch.confidential = input.confidential;
    tx.update(contacts).set(patch).where(eq(contacts.id, id)).run();
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, CONTACT_TAG_BINDING, id, input.tags, now);
  });

  return compose(db, actor, (await db.select().from(contacts).where(eq(contacts.id, id)).get())!);
}

async function deleteContact(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
): Promise<void> {
  await assertContactCapability(db, actor, id, "delete");

  // Atomic hard-delete: the contact row plus its three app-level cleanups
  // (`tags_refs`, policy tuples, shares) commit or roll back together. Contact
  // is the only hard-deleted tag-carrying resource, so a mid-cleanup failure
  // here would otherwise orphan `tags_refs` rows permanently (`resource_id` has
  // no FK and no `type` column, so they are never reachable for cleanup again).
  // Run the deletes synchronously inside the tx — see bun:sqlite tx note.
  const changes = db.transaction((tx) => {
    const result = tx.delete(contacts).where(eq(contacts.id, id)).run() as unknown as RunResult;
    if (result.changes === 0)
      return 0;

    // `tags_refs.resource_id` has no FK, so the row delete cannot cascade its
    // tag links — drop them here (replaces the old per-domain join cascade).
    tx.delete(tagsRefs).where(eq(tagsRefs.resourceId, id)).run();
    // Policy tuples referencing this contact as object or subject.
    tx.delete(relationTuples).where(or(
      and(eq(relationTuples.namespace, "contact"), eq(relationTuples.objectId, id)),
      and(eq(relationTuples.subjectNamespace, "contact"), eq(relationTuples.subjectId, id)),
    )).run();
    // Token-based shares (`shares.resource_id` is polymorphic, no FK).
    tx.delete(shares)
      .where(and(sql`${shares.resourceType} = ${"contact"}`, eq(shares.resourceId, id)))
      .run();
    return result.changes;
  });

  if (changes === 0)
    throw new NotFoundError("Contact", id);
}

export { deleteContact as delete };

export async function grant(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  target: ContactGrantTarget,
): Promise<void> {
  await assertContactCapability(db, actor, id, "share");
  const tuple = targetTuple(id, target);
  await createTuple(db, tuple, actor.id);
}

export async function revoke(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  target: ContactGrantTarget,
): Promise<boolean> {
  await assertContactCapability(db, actor, id, "share");
  return deleteTupleByKey(db, targetTuple(id, target));
}

export async function resolve(db: AppDatabase, id: string): Promise<ContactRow> {
  const row = await db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row)
    throw new NotFoundError("Contact", id);
  return row;
}

export async function compose(
  db: AppDatabase,
  actor: ContactAccessActor,
  row: ContactRow,
): Promise<ContactView> {
  return composeWithCapabilities(db, actor, row, await resolveContactCapabilities(db, row, actor));
}

async function composeWithCapabilities(
  db: AppDatabase,
  actor: ContactAccessActor,
  row: ContactRow,
  caps: Set<ContactCapability>,
): Promise<ContactView> {
  const tagList = await listResourceTagViews(db, CONTACT_TAG_BINDING, row.id);
  const isExplicitViewerOrOwnerOrAdmin = actor.role === "admin"
    || row.ownerId === actor.id
    || (await check(db, "contact", row.id, "viewer", "user", actor.id)).allowed;
  const canSeeFields = canSeeConfidentialFields(actor, row, isExplicitViewerOrOwnerOrAdmin);

  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    contactPerson: canSeeFields ? row.contactPerson : null,
    phone: canSeeFields ? row.phone : null,
    email: canSeeFields ? row.email : null,
    address: canSeeFields ? row.address : null,
    taxId: canSeeFields ? row.taxId : null,
    note: canSeeFields ? row.note : null,
    categoryId: row.categoryId,
    status: canSeeFields ? row.status : null,
    visibility: row.visibility,
    confidential: row.confidential,
    tags: tagList,
    canManage: caps.has("update"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function targetTuple(contactId: string, target: ContactGrantTarget) {
  if (target.type !== "user" && target.type !== "group") {
    throw new ValidationError("Invalid contact share target", {
      type: "Target type must be 'user' or 'group'",
    });
  }
  return {
    namespace: "contact",
    objectId: contactId,
    relation: "viewer",
    subjectNamespace: target.type,
    subjectId: target.id,
    subjectRelation: target.type === "group" ? "member" : null,
  };
}
