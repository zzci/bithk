import type { Context } from "hono";
import type { DriveOwner } from "./drive.service";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { policyContext } from "@/modules/policy";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import { driveAccess } from "./drive.permission";
import {
  buildDriveEntryDownloadResponse,
  createDriveFolder,
  deleteDriveEntryPermanently,
  getDriveEntry,
  listDriveEntries,
  restoreDriveEntry,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";

const entryIdSchema = z.string().min(1);

const listSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  status: z.enum(["normal", "trash"]).optional(),
});

const createFolderSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
});

const updateEntrySchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255).optional(),
  favorite: z.boolean().optional(),
}).refine(v => v.parentEntryId !== undefined || v.name !== undefined || v.favorite !== undefined, {
  message: "At least one field must be provided",
});

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

function personalOwner(userId: string): DriveOwner {
  return { ownerType: "user", ownerId: userId };
}

export function driveRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  router.get("/drive/entries", async (c) => {
    const user = c.get("user")!;
    const query = listSchema.parse({
      parentEntryId: c.req.query("parentEntryId") ?? null,
      status: c.req.query("status") ?? undefined,
    });
    const data = await listDriveEntries(c.get("db"), {
      ...personalOwner(user.id),
      parentEntryId: query.parentEntryId,
      status: query.status,
    });
    return c.json({ success: true, data });
  });

  router.post("/drive/folders", async (c) => {
    const user = c.get("user")!;
    const body = createFolderSchema.parse(await c.req.json());
    const entry = await createDriveFolder(c.get("db"), {
      ...personalOwner(user.id),
      createdBy: user.id,
      parentEntryId: body.parentEntryId,
      name: body.name,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.folder.created",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry }, 201);
  });

  router.post("/drive/files/upload", async (c) => {
    const user = c.get("user")!;
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");

    const parentEntryId = form.get("parentEntryId");
    if (parentEntryId !== null && typeof parentEntryId !== "string")
      throw new AppError("parentEntryId must be a string", 400, "VALIDATION_ERROR");

    const entry = await uploadDriveFile(c.get("db"), c.get("config"), {
      ...personalOwner(user.id),
      createdBy: user.id,
      parentEntryId,
      file,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.file.uploaded",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry }, 201);
  });

  router.get("/drive/entries/:id", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:read", id);
    const entry = await getDriveEntry(c.get("db"), personalOwner(user.id), id);
    if (!entry)
      throw new AppError("Drive entry not found", 404, "NOT_FOUND");
    return c.json({ success: true, data: entry });
  });

  router.get("/drive/entries/:id/content", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:download", id);
    return buildDriveEntryDownloadResponse(
      c.get("db"),
      c.get("config"),
      personalOwner(user.id),
      id,
      c.req.query("inline") === "true",
    );
  });

  router.patch("/drive/entries/:id", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:update", id);
    const body = updateEntrySchema.parse(await c.req.json());
    const entry = await updateDriveEntry(c.get("db"), {
      ...personalOwner(user.id),
      id,
      ...body,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.updated",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry });
  });

  router.delete("/drive/entries/:id/permanent", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:delete", id);
    await deleteDriveEntryPermanently(c.get("db"), c.get("config"), personalOwner(user.id), id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.deleted",
      resourceType: "drive_entry",
      resourceId: id,
      resourceName: id,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id } });
  });

  router.delete("/drive/entries/:id", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:delete", id);
    await trashDriveEntry(c.get("db"), personalOwner(user.id), id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.trashed",
      resourceType: "drive_entry",
      resourceId: id,
      resourceName: id,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id } });
  });

  router.post("/drive/entries/:id/restore", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:update", id);
    const entry = await restoreDriveEntry(c.get("db"), personalOwner(user.id), id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.restored",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry });
  });

  return router;
}
