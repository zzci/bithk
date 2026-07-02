import type { AppDatabase } from "@/db";
import type { PolicyContext } from "@/modules/policy";
import { eq } from "drizzle-orm";
import { defineResource } from "@/modules/policy";
import { check, listUserResources } from "@/modules/policy/zanzibar.engine";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { contacts } from "./schema";

type ContactAction
  = | "contact:read"
    | "contact:update"
    | "contact:delete"
    | "contact:share";

export type ContactCapability = "read" | "update" | "delete" | "share";

const ALL_CAPABILITIES: readonly ContactCapability[] = ["read", "update", "delete", "share"];

const ACTION_CAPABILITY: Record<ContactAction, ContactCapability> = {
  "contact:read": "read",
  "contact:update": "update",
  "contact:delete": "delete",
  "contact:share": "share",
};

export interface ContactAccessActor {
  readonly id: string;
  readonly role: string;
}

type ContactPermissionRow = Pick<typeof contacts.$inferSelect, "id" | "ownerId" | "visibility" | "confidential">;

/**
 * Resolve every capability `actor` has on one contact. Admins, row owners,
 * and explicit `owner` tuples get the full set. Public visibility and
 * explicit `viewer` tuples grant read only.
 */
export async function resolveContactCapabilities(
  db: AppDatabase,
  contact: ContactPermissionRow,
  actor: ContactAccessActor,
): Promise<Set<ContactCapability>> {
  if (actor.role === "admin")
    return new Set(ALL_CAPABILITIES);

  const caps = new Set<ContactCapability>();

  if (contact.ownerId === actor.id) {
    addAll(caps);
    return caps;
  }

  const ownerResult = await check(db, "contact", contact.id, "owner", "user", actor.id);
  if (ownerResult.allowed) {
    addAll(caps);
    return caps;
  }

  const viewerResult = await check(db, "contact", contact.id, "viewer", "user", actor.id);
  if (viewerResult.allowed)
    caps.add("read");

  if (contact.visibility === "public")
    caps.add("read");

  return caps;
}

/**
 * Actor-scoped grant sets for batched capability resolution on list paths.
 * `ownerIds` / `viewerIds` are the contact ids on which the actor holds an
 * explicit owner / viewer grant (viewer includes owner-implied ids, mirroring
 * the namespace's `owner → viewer` computed userset). Both sets are empty for
 * admins, whose role short-circuits every check.
 */
export interface ContactCapabilityContext {
  readonly isAdmin: boolean;
  readonly ownerIds: ReadonlySet<string>;
  readonly viewerIds: ReadonlySet<string>;
}

/**
 * Load the actor's contact grant sets in O(1) queries (two `listUserResources`
 * calls), independent of page size. Feed the result to
 * `resolveContactCapabilitiesFromContext` to resolve per-row capabilities
 * without per-row policy-engine checks.
 */
export async function loadContactCapabilityContext(
  db: AppDatabase,
  actor: ContactAccessActor,
): Promise<ContactCapabilityContext> {
  if (actor.role === "admin")
    return { isAdmin: true, ownerIds: new Set(), viewerIds: new Set() };
  const [ownerIds, viewerIds] = await Promise.all([
    listUserResources(db, actor.id, "contact", "owner"),
    listUserResources(db, actor.id, "contact", "viewer"),
  ]);
  return { isAdmin: false, ownerIds: new Set(ownerIds), viewerIds: new Set(viewerIds) };
}

/**
 * Batched equivalent of `resolveContactCapabilities`: same grant semantics
 * (admin / row owner / owner tuple → full set; viewer tuple / public → read),
 * resolved against a pre-loaded `ContactCapabilityContext` instead of per-row
 * policy-engine checks.
 */
export function resolveContactCapabilitiesFromContext(
  contact: ContactPermissionRow,
  actor: ContactAccessActor,
  ctx: ContactCapabilityContext,
): Set<ContactCapability> {
  if (ctx.isAdmin)
    return new Set(ALL_CAPABILITIES);

  const caps = new Set<ContactCapability>();

  if (contact.ownerId === actor.id || ctx.ownerIds.has(contact.id)) {
    addAll(caps);
    return caps;
  }

  if (ctx.viewerIds.has(contact.id))
    caps.add("read");

  if (contact.visibility === "public")
    caps.add("read");

  return caps;
}

export function canSeeConfidentialFields(
  actor: ContactAccessActor,
  contact: Pick<ContactPermissionRow, "ownerId" | "visibility" | "confidential">,
  isExplicitViewerOrOwnerOrAdmin: boolean,
): boolean {
  if (actor.role === "admin" || contact.ownerId === actor.id || isExplicitViewerOrOwnerOrAdmin)
    return true;
  return !(contact.visibility === "public" && contact.confidential);
}

export async function assertContactCapability(
  db: AppDatabase,
  actor: ContactAccessActor,
  contactId: string,
  capability: ContactCapability,
): Promise<typeof contacts.$inferSelect> {
  const contact = await db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact)
    throw new NotFoundError("Contact", contactId);

  const caps = await resolveContactCapabilities(db, contact, actor);
  if (!caps.has(capability)) {
    if (caps.size === 0)
      throw new NotFoundError("Contact", contactId);
    throw new ForbiddenError();
  }
  return contact;
}

export const contactAccess = defineResource<ContactAction>({
  name: "contact",
  namespace: "contact",
  description: "Global contacts with owner management, explicit viewer grants and public visibility.",
  actions: {
    "contact:read": "viewer",
    "contact:update": "owner",
    "contact:delete": "owner",
    "contact:share": "owner",
  },
  readAction: "contact:read",
  routes: [
    { method: "GET", path: "/contacts/:id", action: "contact:read" },
    { method: "PATCH", path: "/contacts/:id", action: "contact:update" },
    { method: "DELETE", path: "/contacts/:id", action: "contact:delete" },
    { method: "POST", path: "/contacts/:id/grant", action: "contact:share" },
    { method: "POST", path: "/contacts/:id/revoke", action: "contact:share" },
  ],
  hooks: {
    // Only cheap column-derived grants bypass the engine. Explicit viewer and
    // group-member grants intentionally fall through to Zanzibar tuple checks.
    bypass: async (ctx, action, objectId) => hasColumnCapabilityFor(ctx, action, objectId),
    resolveObjectId: async (c, params) => {
      const id = params.id;
      if (!id)
        return null;
      const row = await c.get("db")
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, id))
        .get();
      return row?.id ?? null;
    },
    resolveEntity: async (db, objectId) => {
      const row = await db
        .select({ name: contacts.name })
        .from(contacts)
        .where(eq(contacts.id, objectId))
        .get();
      return row ? { name: row.name, type: "contact", url: "/contacts" } : null;
    },
  },
});

async function hasColumnCapabilityFor(ctx: PolicyContext, action: string, objectId: string): Promise<boolean> {
  const capability = ACTION_CAPABILITY[action as ContactAction];
  if (!capability)
    return false;

  if (ctx.actor.role === "admin")
    return true;

  const contact = await ctx.db
    .select({ ownerId: contacts.ownerId, visibility: contacts.visibility })
    .from(contacts)
    .where(eq(contacts.id, objectId))
    .get();
  if (!contact)
    return false;

  if (contact.ownerId === ctx.actor.id)
    return true;

  return capability === "read" && contact.visibility === "public";
}

function addAll(caps: Set<ContactCapability>): void {
  for (const c of ALL_CAPABILITIES)
    caps.add(c);
}
