import type { TagSourceType } from "./schema";
import type { ResourceTagBinding } from "./tag.service";

// Source registry for the shared tag vocabulary, mirroring the backup-module
// registry pattern. Each domain registers its assignment binding from
// `routes/protected.ts` as a load-time side effect, so the tag module learns
// about project/contact/document join tables without importing their schemas.

const sources = new Map<TagSourceType, ResourceTagBinding>();

/**
 * Register (or replace) a domain's tag assignment binding. Idempotent —
 * re-importing during dev HMR / test reruns must not break; last write wins.
 */
export function registerTagSource(binding: ResourceTagBinding): void {
  sources.set(binding.sourceType, binding);
}

/** Resolve a registered binding by source type. Throws if none is registered. */
export function getTagBinding(sourceType: TagSourceType): ResourceTagBinding {
  const binding = sources.get(sourceType);
  if (!binding)
    throw new Error(`No tag source registered for type '${sourceType}'`);
  return binding;
}

/** Every source type that currently has a registered binding. */
export function listRegisteredSourceTypes(): TagSourceType[] {
  return [...sources.keys()];
}
