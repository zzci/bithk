// Frontend resource registry for sharing — mirrors the backend share adapter
// registry. Each resource type registers how its public-link landing page
// renders and (optionally) an extra section injected into the share dialog
// (e.g. a document's collaborator grants). The share components read this
// registry instead of branching on resource type inline.

import type { ReactNode } from "react";
import type { PublicShareMeta, ShareResourceType } from "@/shared/lib/api/share";

/** Contract a resource implements to participate in the unified share UI. */
export interface ShareResourceDefinition {
  readonly resourceType: ShareResourceType;
  /** i18n key (in the `share` namespace) for this resource's display label. */
  readonly labelKey: string;
  /** Render the public, unauthenticated landing preview for a token. */
  readonly renderPublicPreview: (meta: PublicShareMeta, token: string) => ReactNode;
  /**
   * Optional extra section rendered inside the management dialog below the
   * unified controls (e.g. document collaborator grants). The slot keeps
   * using its own resource-specific API.
   */
  readonly renderExtraSection?: (resourceId: string) => ReactNode;
}

const registry = new Map<ShareResourceType, ShareResourceDefinition>();

export function registerShareResource(definition: ShareResourceDefinition): void {
  registry.set(definition.resourceType, definition);
}

export function getShareResource(type: ShareResourceType): ShareResourceDefinition | undefined {
  return registry.get(type);
}
