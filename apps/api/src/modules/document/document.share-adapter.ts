import type { AppDatabase } from "@/db";
import type { ShareAdapter, ShareContent, ShareResolved } from "@/modules/share";
import { getFileById, getReferenceById, listAttachmentsByOwner } from "@/modules/file";
import { getItemByShortId } from "@/modules/item/item.service";
import { policyContext } from "@/modules/policy";
import { registerShareAdapter } from "@/modules/share";
import { NotFoundError } from "@/shared/lib/errors";
import { documentAccess } from "./document.permission";
import { getDocumentByItemId, listPublicSubtree } from "./document.service";

// Documents are shared by their public-facing `short_id` (the same handle the
// app and URLs use). The adapter translates it to the internal `items.id` for
// subtree / content lookups.
async function rootItemId(db: AppDatabase, shortId: string): Promise<string | null> {
  const item = await getItemByShortId(db, shortId);
  return item && item.type === "document" ? item.id : null;
}

const adapter: ShareAdapter = {
  resourceType: "document",
  // Document public links are anonymous, view-only, single-link. Collaborator
  // (viewer/editor) grants are policy tuples, not shares — out of scope here.
  capabilities: {
    shareTypes: ["public_link"],
    permissions: ["view"],
  },

  authorizeManage: async (c, resourceId) => {
    const item = await getItemByShortId(c.get("db"), resourceId);
    if (!item || item.type !== "document")
      throw new NotFoundError("Document", resourceId);
    await documentAccess.assert(policyContext(c)!, "document:manage", item.id);
  },

  resolve: async (db, resourceId): Promise<ShareResolved | null> => {
    const itemId = await rootItemId(db, resourceId);
    if (!itemId)
      return null;
    const doc = await getDocumentByItemId(db, itemId);
    if (!doc)
      return null;
    // Document subtrees are navigated via the content payload, not the folder
    // listing routes, so `isFolder` stays false.
    return { name: doc.title, isFolder: false, file: null };
  },

  // View-only content: the addressed document (root or descendant short_id),
  // its attachments, and the navigable subtree. Revoking the link kills the
  // whole subtree.
  getContent: async (db, share, childId) => {
    const itemId = await rootItemId(db, share.resourceId);
    if (!itemId)
      throw new NotFoundError("Shared document", share.resourceId);
    const subtree = await listPublicSubtree(db, itemId);
    const root = subtree.find(n => n.itemId === itemId);
    if (!root)
      throw new NotFoundError("Shared document", share.resourceId);
    const target = childId ? subtree.find(n => n.id === childId) : root;
    if (!target)
      throw new NotFoundError("Shared document", childId ?? share.resourceId);

    const composed = await getDocumentByItemId(db, target.itemId);
    if (!composed)
      throw new NotFoundError("Shared document", childId ?? share.resourceId);
    // Scope parentId to the shared subtree so we never leak an ancestor
    // short_id outside the link's scope.
    const document = { ...composed, parentId: target.parentId };
    const attachments = await listAttachmentsByOwner(db, "item_attachment", target.itemId);

    return {
      document,
      attachments,
      subtree: subtree.map(n => ({ id: n.id, title: n.title, parentId: n.parentId })),
    };
  },

  // Attachment download. `childId` is the attachment reference id; its owning
  // document must live inside the link's subtree (IDOR guard).
  openFile: async (db, share, childId): Promise<ShareContent> => {
    if (!childId)
      throw new NotFoundError("Attachment", share.resourceId);
    const itemId = await rootItemId(db, share.resourceId);
    if (!itemId)
      throw new NotFoundError("Shared document", share.resourceId);

    const reference = await getReferenceById(db, childId);
    if (!reference || reference.ownerType !== "item_attachment")
      throw new NotFoundError("Attachment", childId);

    const subtree = await listPublicSubtree(db, itemId);
    if (!subtree.some(n => n.itemId === reference.ownerId))
      throw new NotFoundError("Attachment", childId);

    const file = await getFileById(db, reference.fileId);
    if (!file)
      throw new NotFoundError("Attachment", childId);
    return { file, reference };
  },
};

registerShareAdapter(adapter);
