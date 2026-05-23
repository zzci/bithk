// App-level mount for the unified share dialog. Reads the current target from
// the share store, fetches its capabilities + active shares, resolves the
// resource's optional extra section from the registry, and renders the ONE
// `ShareDialog`. Mounting near the app root means every caller shares this
// single dialog instance via `useShare().openShare(...)`.

import { useResourceShares, useShareCapabilities } from "@/shared/lib/api/share";
import { getShareResource } from "@/shared/lib/share/registry";

import { ShareDialog } from "./share-dialog";
import { useShareTarget } from "./use-share";

export function ShareDialogHost() {
  const { target } = useShareTarget();
  if (!target)
    return null;
  return <ActiveShareDialog />;
}

function ActiveShareDialog() {
  const { target, closeShare } = useShareTarget();
  const capabilitiesQuery = useShareCapabilities(target?.resourceType);
  const sharesQuery = useResourceShares(target?.resourceType, target?.resourceId);

  // The host already gated on `target`, but the inner component re-reads it to
  // keep its hooks unconditional; bail if it cleared between renders.
  if (!target)
    return null;

  const capabilities = capabilitiesQuery.data;
  // Capabilities define the whole control set, so wait for them before
  // rendering the dialog body rather than flashing an empty shell.
  if (!capabilities)
    return null;

  const definition = getShareResource(target.resourceType);
  const extraSection = definition?.renderExtraSection?.(target.resourceId) ?? null;

  return (
    <ShareDialog
      target={target}
      capabilities={capabilities}
      shares={sharesQuery.data ?? []}
      sharesLoading={sharesQuery.isLoading}
      extraSection={extraSection}
      onClose={closeShare}
    />
  );
}
