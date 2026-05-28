import type { ContactAccessActor, ContactCapability } from "./contact.permission";
import type { ContactStatus, ContactVisibility } from "./schema";
import type { AppDatabase, RunResult } from "@/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createTuple, deleteTupleByKey, deleteTuplesForEntity } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { check, listUserResources } from "@/modules/policy/zanzibar.engine";
import { shares } from "@/modules/share/schema";
import { listResourceIdsByTag, listResourceTagViews, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { NotFoundError, ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import {
  assertContactCapability,
  canSeeConfidentialFields,
  resolveContactCapabilities,
} from "./contact.permission";
import { contacts, contactTags } from "./schema";

const CONTACT_TAG_BINDING = {
  sourceType: "contact",
  table: contactTags,
  resourceColumn: contactTags.contactId,
  tagColumn: contactTags.tagId,
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
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface ListContactsParams {
  readonly tag?: string | undefined;
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
): Promise<readonly ContactView[]> {
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

  if (params.tag) {
    const ids = await listResourceIdsByTag(db, CONTACT_TAG_BINDING, params.tag);
    if (ids.length === 0)
      return [];
    conditions.push(inArray(contacts.id, ids));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.createdAt), desc(contacts.id))
    .all();

  const views: ContactView[] = [];
  for (const row of rows) {
    const caps = await resolveContactCapabilities(db, row, actor);
    if (caps.size === 0)
      continue;
    views.push(await composeWithCapabilities(db, actor, row, caps));
  }
  return views;
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
  const result = await db.delete(contacts).where(eq(contacts.id, id)).run() as unknown as RunResult;
  if (result.changes === 0)
    throw new NotFoundError("Contact", id);

  await deleteTuplesForEntity(db, "contact", id);
  await deleteContactShares(db, id);
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

async function deleteContactShares(db: AppDatabase, contactId: string): Promise<void> {
  await db.delete(shares)
    .where(and(sql`${shares.resourceType} = ${"contact"}`, eq(shares.resourceId, contactId)))
    .run();
}
