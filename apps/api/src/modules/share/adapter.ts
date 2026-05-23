import type { Context } from "hono";
import type { SharePermission, ShareResourceType, ShareType } from "./schema";
import type { AppDatabase } from "@/db";
import type { FileReferenceRow, FileRow } from "@/modules/file/file.service";
import type { AppEnv } from "@/shared/lib/types";

/** A downloadable file resolved from a share (drive file / folder child / document attachment). */
export interface ShareContent {
  readonly file: FileRow;
  readonly reference: FileReferenceRow;
}

/** Resolved display metadata for a shared resource. `file` is set only when the resource is a single file. */
export interface ShareResolved {
  readonly name: string;
  readonly isFolder: boolean;
  readonly file?: { readonly filename: string; readonly mimetype: string; readonly size: number } | null;
}

/** One entry inside a publicly browsed folder share. */
export interface PublicShareEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "file" | "folder";
  readonly size: number | null;
  readonly mimetype: string | null;
}

/** A listing within a shared folder subtree plus a breadcrumb from the shared root. */
export interface PublicShareListing {
  readonly breadcrumb: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly PublicShareEntry[];
}

/** The validated share row handed to content callbacks (no password hash exposure intended). */
export interface ShareGateRow {
  readonly id: string;
  readonly resourceType: ShareResourceType;
  readonly resourceId: string;
  readonly permission: SharePermission;
}

/**
 * Resource-specific behaviour for the unified share module. The share module
 * owns identity / auth / lifecycle (token, password, expiry, exhaustion,
 * inboxes); the adapter owns content rendering for its `resourceType`.
 *
 * Owning modules register their adapter via a side-effect import in their
 * `index.ts`, mirroring the backup-contribution registry pattern.
 */
export interface ShareAdapter {
  readonly resourceType: ShareResourceType;
  /** Which share types / permissions are valid for this resource (drives create-time validation + UI capabilities). */
  readonly capabilities: {
    readonly shareTypes: readonly ShareType[];
    readonly permissions: readonly SharePermission[];
  };
  /**
   * Authorize the caller to manage (create / list) shares for this resource.
   * Resource-specific (drive share capability, document `document:manage`).
   * Throws Forbidden / NotFound on failure. Update / revoke are ownership-based
   * and handled generically by the share module, so they need no hook.
   */
  authorizeManage: (c: Context<AppEnv>, resourceId: string) => Promise<void>;
  /** Validate the resource exists and is shareable; returns display metadata or null when missing. */
  resolve: (db: AppDatabase, resourceId: string) => Promise<ShareResolved | null>;
  /** Resource-specific JSON payload returned after the public gate passes (e.g. document content + subtree). */
  getContent?: (db: AppDatabase, share: ShareGateRow, childId: string | undefined) => Promise<unknown>;
  /** Folder-like listing (drive folders); absent for non-hierarchical resources. */
  listChildren?: (db: AppDatabase, share: ShareGateRow, childId: string | undefined) => Promise<PublicShareListing>;
  /** Resolve a downloadable file, enforcing resource-specific permission rules. Throws on forbidden / not-found. */
  openFile?: (db: AppDatabase, share: ShareGateRow, childId: string | undefined) => Promise<ShareContent>;
}

const registry = new Map<ShareResourceType, ShareAdapter>();

/** Register a resource adapter. Called once per module at load time. */
export function registerShareAdapter(adapter: ShareAdapter): void {
  registry.set(adapter.resourceType, adapter);
}

/** Look up a registered adapter, or `undefined` for an unknown resource type. */
export function findShareAdapter(resourceType: ShareResourceType): ShareAdapter | undefined {
  return registry.get(resourceType);
}
