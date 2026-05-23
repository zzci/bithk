// App-level share dialog controller. A single Zustand store holds the current
// share target so any caller can open the ONE `<ShareDialogHost>` mount via
// `useShare().openShare({ resourceType, resourceId, name })`.

import type { ShareResourceType } from "@/shared/lib/api/share";
import { create } from "zustand";

export interface ShareTarget {
  readonly resourceType: ShareResourceType;
  readonly resourceId: string;
  readonly name: string;
}

interface ShareDialogState {
  readonly target: ShareTarget | null;
  readonly openShare: (target: ShareTarget) => void;
  readonly closeShare: () => void;
}

const useShareDialogStore = create<ShareDialogState>(set => ({
  target: null,
  openShare: target => set({ target }),
  closeShare: () => set({ target: null }),
}));

/** Open the shared share dialog for a resource. */
export function useShare(): { readonly openShare: (target: ShareTarget) => void } {
  const openShare = useShareDialogStore(s => s.openShare);
  return { openShare };
}

/** Internal: the host reads the current target + close action. */
export function useShareTarget(): { readonly target: ShareTarget | null; readonly closeShare: () => void } {
  const target = useShareDialogStore(s => s.target);
  const closeShare = useShareDialogStore(s => s.closeShare);
  return { target, closeShare };
}
