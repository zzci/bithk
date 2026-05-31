import type { TagType } from "./schema";
import type { ResourceTagBinding } from "./tag.service";

// Source registry for the shared tag vocabulary, mirroring the backup-module
// registry pattern. Each domain registers its `{ type }` binding from
// `routes/protected.ts` as a load-time side effect, so the shared `/tags`
// routes learn which types exist without importing any domain schema.

const sources = new Map<TagType, ResourceTagBinding>();

/**
 * Register (or replace) a domain's tag binding. Idempotent — re-importing
 * during dev HMR / test reruns must not break; last write wins.
 */
export function registerTagSource(binding: ResourceTagBinding): void {
  sources.set(binding.type, binding);
}

/** Resolve a registered binding by type. Throws if none is registered. */
export function getTagBinding(type: TagType): ResourceTagBinding {
  const binding = sources.get(type);
  if (!binding)
    throw new Error(`No tag source registered for type '${type}'`);
  return binding;
}

/** Every type that currently has a registered binding. */
export function listRegisteredSourceTypes(): TagType[] {
  return [...sources.keys()];
}
