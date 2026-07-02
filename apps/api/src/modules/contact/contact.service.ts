import type { ContactAccessActor, ContactCapability, ContactCapabilityContext } from "./contact.permission";
import type { ContactKind, ContactStatus, ContactVisibility } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase, AppTransaction } from "@/db";
import type { FileServiceConfig } from "@/modules/file";
import { and, count, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import { runWrite } from "@/db";
import { ACCEPT_IMAGES, fileInlineContentUrl, finalizeReleasedBlob, getReferenceById, releaseReferenceTx, uploadAndReference } from "@/modules/file";
import { createTuple, deleteTupleByKey } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { check } from "@/modules/policy/zanzibar.engine";
import { shares } from "@/modules/share/schema";
import { tagsRefs } from "@/modules/tag/schema";
import { listResourceIdsByAnyTag, listResourceTagViews, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { NotFoundError, ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import {
  assertContactCapability,
  canSeeConfidentialFields,
  loadContactCapabilityContext,
  resolveContactCapabilities,
  resolveContactCapabilitiesFromContext,
} from "./contact.permission";
import { CONTACT_KINDS, contacts } from "./schema";

/** Contact tag binding (tag type='contact'), passed to the shared tag helpers. */
const CONTACT_TAG_BINDING = {
  type: "contact",
} as const;

/** owner_type for the single avatar/logo `file_references` row of a contact. */
export const CONTACT_AVATAR_OWNER_TYPE = "contact_avatar";

export type ContactRow = typeof contacts.$inferSelect;

export interface ContactTagView {
  readonly id: string;
  readonly name: string;
}

/**
 * Embedded company summary for an individual's linked organization. Sensitive
 * fields respect the ORG'S OWN visibility/confidential masking for the reading
 * actor (resolved independently of the individual being read); `name` is always
 * present. Null for organization rows or unlinked individuals.
 */
export interface ContactOrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly website: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
}

export interface ContactView {
  readonly id: string;
  readonly kind: ContactKind;
  readonly ownerId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly position: string | null;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly organization: ContactOrganizationSummary | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly note: string | null;
  readonly attributes: Record<string, string> | null;
  readonly avatarReferenceId: string | null;
  readonly avatarUrl: string | null;
  readonly categoryId: string | null;
  readonly status: ContactStatus | null;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly tags: readonly ContactTagView[];
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Company fields to seed onto an organization created on-the-fly from
 * `organizationName`. Only meaningful with `organizationName`; ignored when an
 * existing `organizationId` is supplied or no org link is requested.
 */
export interface OrganizationAttributesInput {
  readonly website?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
}

export interface CreateContactInput {
  // Defaults to 'organization' when omitted (e.g. internal supplier creation).
  readonly kind?: ContactKind | undefined;
  readonly name: string;
  // Shared by both kinds.
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly note?: string | null | undefined;
  // Individual-only.
  readonly position?: string | null | undefined;
  readonly organizationId?: string | null | undefined;
  readonly organizationName?: string | null | undefined;
  readonly organizationAttributes?: OrganizationAttributesInput | undefined;
  readonly attributes?: Record<string, string> | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface UpdateContactInput {
  // `kind` is immutable; provided only so a caller-supplied change is rejected.
  readonly kind?: ContactKind | undefined;
  readonly name?: string | undefined;
  // Shared by both kinds.
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly note?: string | null | undefined;
  // Individual-only.
  readonly position?: string | null | undefined;
  readonly organizationId?: string | null | undefined;
  readonly organizationName?: string | null | undefined;
  readonly organizationAttributes?: OrganizationAttributesInput | undefined;
  readonly attributes?: Record<string, string> | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly visibility?: ContactVisibility | undefined;
  readonly confidential?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface ListContactsParams {
  readonly kind?: ContactKind | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly categoryId?: string | undefined;
  readonly q?: string | undefined;
  readonly status?: ContactStatus | undefined;
  // Derived 3-state filter over visibility/confidential (see CONTACT_SENSITIVITIES).
  readonly sensitivity?: "public" | "private" | "confidential" | undefined;
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

/** Build the inline content URL the frontend renders in an <img>. */
function buildAvatarUrl(fileId: string, referenceId: string): string {
  return fileInlineContentUrl(fileId, referenceId);
}

/**
 * Validate and serialize the free-form `attributes` map. Accepts a flat object
 * whose keys and values are all strings; rejects arrays, nested objects, and
 * non-string values. Returns the JSON string (null when empty/absent).
 */
function serializeAttributes(attributes: Record<string, string> | null | undefined): string | null {
  if (attributes === undefined || attributes === null)
    return null;
  if (typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new ValidationError("Invalid attributes", { attributes: "Must be a flat object of string keys and string values" });
  }
  const entries = Object.entries(attributes);
  if (entries.length === 0)
    return null;
  if (entries.length > 50)
    throw new ValidationError("Invalid attributes", { attributes: "At most 50 keys allowed" });
  for (const [key, value] of entries) {
    if (typeof value !== "string")
      throw new ValidationError("Invalid attributes", { attributes: `Value for "${key}" must be a string` });
  }
  return JSON.stringify(Object.fromEntries(entries));
}

function parseAttributes(raw: string | null): Record<string, string> | null {
  if (!raw)
    return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, string>;
  }
  catch {
    // Corrupt JSON is treated as "no attributes" rather than crashing reads.
  }
  return null;
}

/**
 * Reject fields that do not belong to a contact's kind. `phone`, `email`,
 * `website`, `taxId`, `address`, `note`, `attributes`, `categoryId`, `status`,
 * `visibility`, `confidential`, and `tags` are valid on both kinds. Only
 * `position`, the organization link (`organizationId` / `organizationName` /
 * `organizationAttributes`) are individual-only; an individual rejects nothing.
 */
function assertKindFields(
  kind: ContactKind,
  input: { position?: unknown; organizationId?: unknown; organizationName?: unknown; organizationAttributes?: unknown },
): void {
  if (kind === "organization") {
    if (input.position !== undefined || input.organizationId !== undefined || input.organizationName !== undefined || input.organizationAttributes !== undefined) {
      throw new ValidationError("Invalid fields for organization", {
        kind: "position, organizationId, organizationName, and organizationAttributes are only valid for individuals",
      });
    }
  }
}

/**
 * Resolve the organization link for an individual inside a write transaction.
 * Returns the linked organization id, or null when no link is requested.
 * - `organizationId` set → validate it points at an existing organization.
 * - else `organizationName` non-empty → create a new organization, owned by the
 *   same actor, in this transaction and link it. Company fields supplied via
 *   `organizationAttributes` (website/email/phone/address/taxId) are seeded onto
 *   the new org row; `name` is always required.
 */
function resolveOrganizationLinkTx(
  tx: AppTransaction,
  actor: ContactAccessActor,
  input: {
    organizationId?: string | null | undefined;
    organizationName?: string | null | undefined;
    organizationAttributes?: OrganizationAttributesInput | undefined;
  },
  now: string,
): string | null {
  if (input.organizationId) {
    const org = tx.select({ id: contacts.id, kind: contacts.kind })
      .from(contacts)
      .where(eq(contacts.id, input.organizationId))
      .get();
    if (!org || org.kind !== "organization") {
      throw new ValidationError("Invalid organization", { organizationId: "Must reference an existing organization contact" });
    }
    return org.id;
  }

  const orgName = input.organizationName?.trim();
  if (orgName) {
    const orgId = nanoid();
    const attrs = input.organizationAttributes;
    tx.insert(contacts).values({
      id: orgId,
      kind: "organization",
      ownerId: actor.id,
      name: orgName,
      phone: attrs?.phone ?? null,
      email: attrs?.email ?? null,
      website: attrs?.website ?? null,
      taxId: attrs?.taxId ?? null,
      address: attrs?.address ?? null,
      status: "active",
      visibility: "private",
      confidential: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    tx.insert(relationTuples).values({
      id: nanoid(),
      namespace: "contact",
      objectId: orgId,
      relation: "owner",
      subjectNamespace: "user",
      subjectId: actor.id,
      subjectRelation: null,
      createdBy: actor.id,
      createdAt: now,
    }).run();
    return orgId;
  }

  return null;
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
  const kind = input.kind ?? "organization";
  if (!(CONTACT_KINDS as readonly string[]).includes(kind))
    throw new ValidationError("Invalid kind", { kind: "Must be 'individual' or 'organization'" });
  assertKindFields(kind, input);
  const attributes = serializeAttributes(input.attributes);

  const id = nanoid();
  const now = new Date().toISOString();

  // Sensitivity invariant: confidential always implies private (a contact is
  // never both public and confidential at rest). A confidential create with
  // visibility='public' is coerced back to 'private'.
  const confidential = input.confidential ?? false;
  const visibility = confidential ? "private" : (input.visibility ?? "private");

  db.transaction((tx) => {
    const organizationId = kind === "individual"
      ? resolveOrganizationLinkTx(tx, actor, input, now)
      : null;

    tx.insert(contacts).values({
      id,
      kind,
      ownerId: actor.id,
      name: input.name,
      // Shared by both kinds.
      note: input.note ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      taxId: input.taxId ?? null,
      address: input.address ?? null,
      // Individual-only.
      position: kind === "individual" ? input.position ?? null : null,
      organizationId,
      attributes,
      categoryId: input.categoryId ?? null,
      status: input.status ?? "active",
      visibility,
      confidential,
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

  // One O(1) grant-set load per request replaces the old per-row policy
  // checks; its viewer set also backs the access-filter clause below.
  const capabilityCtx = await loadContactCapabilityContext(db, actor);
  const isAdmin = capabilityCtx.isAdmin;
  let explicitIds: readonly string[] = [];
  if (!isAdmin) {
    explicitIds = [...capabilityCtx.viewerIds];
    const access = [
      eq(contacts.ownerId, actor.id),
      eq(contacts.visibility, "public" as const),
    ];
    if (explicitIds.length > 0)
      access.push(inArray(contacts.id, [...explicitIds]));
    conditions.push(or(...access)!);
  }

  if (params.kind)
    conditions.push(eq(contacts.kind, params.kind));

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

  // Derived sensitivity filter, mapped onto the two stored columns. Pushed
  // after (and AND-composed with) the access-control clause, so it only ever
  // narrows the caller's visible set — never widens it.
  if (params.sensitivity === "public")
    conditions.push(eq(contacts.visibility, "public" as const));
  else if (params.sensitivity === "private")
    conditions.push(and(eq(contacts.visibility, "private" as const), eq(contacts.confidential, false))!);
  else if (params.sensitivity === "confidential")
    conditions.push(eq(contacts.confidential, true));
  if (params.q && params.q.length > 0) {
    const like = `%${escapeLike(params.q)}%`;
    const nameMatch = sql`${contacts.name} LIKE ${like} ESCAPE '\\'`;
    const confidentialMatch = sql`${contacts.note} LIKE ${like} ESCAPE '\\'`;
    if (isAdmin) {
      conditions.push(or(nameMatch, confidentialMatch)!);
    }
    else {
      // `name` is always visible; `note` is masked by `composeWithCapabilities`
      // for non-privileged actors on public+confidential rows. Gating the
      // confidential-field match to rows whose fields this actor can actually
      // see (owner / explicit viewer / not public-confidential — mirrors
      // `canSeeConfidentialFields`) stops a search hit/miss oracle that would
      // otherwise leak the masked values character-by-character.
      const fieldsVisible = [
        eq(contacts.ownerId, actor.id),
        not(and(eq(contacts.visibility, "public" as const), eq(contacts.confidential, true))!),
      ];
      if (explicitIds.length > 0)
        fieldsVisible.push(inArray(contacts.id, [...explicitIds]));
      conditions.push(or(nameMatch, and(or(...fieldsVisible)!, confidentialMatch)!)!);
    }
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
    const caps = resolveContactCapabilitiesFromContext(row, actor, capabilityCtx);
    if (caps.size === 0)
      continue;
    views.push(await composeWithCapabilities(db, actor, row, caps, capabilityCtx));
  }
  return { data: views, total: paginate ? total! : views.length };
}

export async function update(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  input: UpdateContactInput,
): Promise<ContactView> {
  const existing = await assertContactCapability(db, actor, id, "update");

  if (input.kind !== undefined && input.kind !== existing.kind)
    throw new ValidationError("Kind is immutable", { kind: "A contact's kind cannot be changed" });
  assertKindFields(existing.kind, input);

  const now = new Date().toISOString();
  db.transaction((tx) => {
    const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined)
      patch.name = input.name;
    // Shared by both kinds.
    if (input.phone !== undefined)
      patch.phone = input.phone;
    if (input.email !== undefined)
      patch.email = input.email;
    if (input.website !== undefined)
      patch.website = input.website;
    if (input.taxId !== undefined)
      patch.taxId = input.taxId;
    if (input.address !== undefined)
      patch.address = input.address;
    if (input.note !== undefined)
      patch.note = input.note;
    if (input.attributes !== undefined)
      patch.attributes = serializeAttributes(input.attributes);
    if (input.categoryId !== undefined)
      patch.categoryId = input.categoryId;
    if (input.status !== undefined)
      patch.status = input.status;
    if (input.visibility !== undefined)
      patch.visibility = input.visibility;
    if (input.confidential !== undefined)
      patch.confidential = input.confidential;

    if (existing.kind === "individual") {
      if (input.position !== undefined)
        patch.position = input.position;
      // Org link: explicit null clears it; an id/name set or replaces it.
      if (input.organizationId === null) {
        patch.organizationId = null;
      }
      else if (input.organizationId !== undefined || (input.organizationName !== undefined && input.organizationName !== null)) {
        patch.organizationId = resolveOrganizationLinkTx(tx, actor, input, now);
      }
    }

    // Sensitivity invariant: confidential always implies private. Using the
    // EFFECTIVE confidential (incoming patch else the stored value) catches
    // both "set confidential=true alongside visibility='public'" and "an
    // already-confidential row receiving visibility='public'" — either coerces
    // visibility back to 'private'.
    const effectiveConfidential = patch.confidential ?? existing.confidential;
    if (effectiveConfidential)
      patch.visibility = "private";

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
  config: FileServiceConfig,
): Promise<void> {
  const row = await assertContactCapability(db, actor, id, "delete");
  const avatarRef = row.avatarReferenceId;

  // Atomic hard-delete: the contact row plus its app-level cleanups
  // (`tags_refs`, policy tuples, shares, avatar reference) commit or roll back
  // together. Contact is the only hard-deleted tag-carrying resource, so a
  // mid-cleanup failure here would otherwise orphan `tags_refs` rows
  // permanently (`resource_id` has no FK and no `type` column, so they are
  // never reachable for cleanup again). Run the deletes synchronously inside
  // the tx — see bun:sqlite tx note. Dependent individuals' organization_id is
  // cleared by the self-FK ON DELETE SET NULL.
  let drained: ReturnType<typeof releaseReferenceTx> = null;
  const changes = db.transaction((tx) => {
    const result = runWrite(() => tx.delete(contacts).where(eq(contacts.id, id)).run());
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
    // Release the avatar/logo reference (decrement ref_count). The contact row
    // is already gone, so the file_references row is unconstrained to delete.
    if (avatarRef)
      drained = releaseReferenceTx(tx, avatarRef);
    return result.changes;
  });

  if (changes === 0)
    throw new NotFoundError("Contact", id);

  await finalizeReleasedBlob(db, config, drained);
}

export { deleteContact as delete };

/**
 * Replace a contact's avatar/logo image. Mirrors the project-cover flow:
 * repoint `avatar_reference_id` and release the previous reference in one tx.
 * Gated on the contact 'update' capability.
 */
export async function setAvatar(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  file: File,
  config: Config,
): Promise<ContactView> {
  await assertContactCapability(db, actor, id, "update");

  const { reference } = await uploadAndReference(db, config, {
    file,
    ownerType: CONTACT_AVATAR_OWNER_TYPE,
    ownerId: id,
    uploadedBy: actor.id,
    accept: ACCEPT_IMAGES,
  });

  const now = new Date().toISOString();
  const row = (await db.select().from(contacts).where(eq(contacts.id, id)).get())!;
  const previous = row.avatarReferenceId;
  const drained = db.transaction((tx) => {
    tx.update(contacts)
      .set({ avatarReferenceId: reference.id, updatedAt: now })
      .where(eq(contacts.id, id))
      .run();
    return previous && previous !== reference.id ? releaseReferenceTx(tx, previous) : null;
  });
  await finalizeReleasedBlob(db, config, drained);

  return compose(db, actor, (await db.select().from(contacts).where(eq(contacts.id, id)).get())!);
}

/** Remove a contact's avatar/logo image (no-op when it has none). */
export async function removeAvatar(
  db: AppDatabase,
  actor: ContactAccessActor,
  id: string,
  config: FileServiceConfig,
): Promise<ContactView> {
  await assertContactCapability(db, actor, id, "update");

  const row = (await db.select().from(contacts).where(eq(contacts.id, id)).get())!;
  const previous = row.avatarReferenceId;
  if (previous) {
    const now = new Date().toISOString();
    const drained = db.transaction((tx) => {
      tx.update(contacts)
        .set({ avatarReferenceId: null, updatedAt: now })
        .where(eq(contacts.id, id))
        .run();
      return releaseReferenceTx(tx, previous);
    });
    await finalizeReleasedBlob(db, config, drained);
  }

  return compose(db, actor, (await db.select().from(contacts).where(eq(contacts.id, id)).get())!);
}

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

async function resolveOrganizationName(db: AppDatabase, organizationId: string | null): Promise<string | null> {
  if (!organizationId)
    return null;
  const row = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, organizationId)).get();
  return row?.name ?? null;
}

/**
 * Resolve the embedded company summary for an individual's linked organization.
 * Sensitive fields respect the ORG'S OWN visibility/confidential masking for
 * this actor (resolved independently of the individual being read, exactly as
 * `composeWithCapabilities` would for a direct read of the org); `name` is
 * always present. Returns null when there is no link or the org is gone.
 */
async function resolveOrganizationSummary(
  db: AppDatabase,
  actor: ContactAccessActor,
  organizationId: string | null,
  ctx?: ContactCapabilityContext,
): Promise<ContactOrganizationSummary | null> {
  if (!organizationId)
    return null;
  const org = await db.select().from(contacts).where(eq(contacts.id, organizationId)).get();
  if (!org)
    return null;

  const isExplicitViewerOrOwnerOrAdmin = actor.role === "admin"
    || org.ownerId === actor.id
    || (ctx
      ? ctx.viewerIds.has(org.id)
      : (await check(db, "contact", org.id, "viewer", "user", actor.id)).allowed);
  const canSeeFields = canSeeConfidentialFields(actor, org, isExplicitViewerOrOwnerOrAdmin);

  return {
    id: org.id,
    name: org.name,
    website: canSeeFields ? org.website : null,
    email: canSeeFields ? org.email : null,
    phone: canSeeFields ? org.phone : null,
    address: canSeeFields ? org.address : null,
    taxId: canSeeFields ? org.taxId : null,
  };
}

async function resolveAvatarUrl(db: AppDatabase, avatarReferenceId: string | null): Promise<string | null> {
  if (!avatarReferenceId)
    return null;
  const ref = await getReferenceById(db, avatarReferenceId);
  if (!ref)
    return null;
  return buildAvatarUrl(ref.fileId, ref.id);
}

async function composeWithCapabilities(
  db: AppDatabase,
  actor: ContactAccessActor,
  row: ContactRow,
  caps: Set<ContactCapability>,
  // Present on the list path only: swaps the per-row viewer policy check for
  // a pre-loaded grant-set lookup. Detail-path callers omit it.
  ctx?: ContactCapabilityContext,
): Promise<ContactView> {
  const tagList = await listResourceTagViews(db, CONTACT_TAG_BINDING, row.id);
  const isExplicitViewerOrOwnerOrAdmin = actor.role === "admin"
    || row.ownerId === actor.id
    || (ctx
      ? ctx.viewerIds.has(row.id)
      : (await check(db, "contact", row.id, "viewer", "user", actor.id)).allowed);
  const canSeeFields = canSeeConfidentialFields(actor, row, isExplicitViewerOrOwnerOrAdmin);
  const organizationName = await resolveOrganizationName(db, row.organizationId);
  const organization = await resolveOrganizationSummary(db, actor, row.organizationId, ctx);
  const avatarUrl = await resolveAvatarUrl(db, row.avatarReferenceId);

  return {
    id: row.id,
    kind: row.kind,
    ownerId: row.ownerId,
    name: row.name,
    phone: canSeeFields ? row.phone : null,
    email: canSeeFields ? row.email : null,
    website: canSeeFields ? row.website : null,
    position: canSeeFields ? row.position : null,
    organizationId: row.organizationId,
    organizationName,
    organization,
    taxId: canSeeFields ? row.taxId : null,
    address: canSeeFields ? row.address : null,
    note: canSeeFields ? row.note : null,
    attributes: parseAttributes(row.attributes),
    avatarReferenceId: row.avatarReferenceId,
    avatarUrl,
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
