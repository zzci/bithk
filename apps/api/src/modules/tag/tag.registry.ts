import type { TagType } from "./schema";
import type { ResourceTagBinding } from "./tag.service";

// Source registry for the shared tag vocabulary. Each domain registers its
// `{ type }` binding from `routes/protected.ts` as a load-time side effect.
// The registry only records bindings; the shared `/tags` routes validate the
// requested type against the static `TAG_TYPES` enum, so there is no read path
// here. The former `getTagBinding` / `listRegisteredSourceTypes` accessors were
// unused dead code and have been removed.

const sources = new Map<TagType, ResourceTagBinding>();

/**
 * Register (or replace) a domain's tag binding. Idempotent — re-importing
 * during dev HMR / test reruns must not break; last write wins.
 */
export function registerTagSource(binding: ResourceTagBinding): void {
  sources.set(binding.type, binding);
}
