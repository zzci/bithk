import type { ApiEnvelope } from "@/shared/lib/api/types";
import { useQuery } from "@tanstack/react-query";
import { APP_DISPLAY_NAME } from "@/shared/lib/branding";
import { http } from "@/shared/lib/http";

interface BrandingPayload {
  readonly appDisplayName: string;
}

export const brandingKeys = {
  detail: ["system", "branding"] as const,
};

async function fetchBranding(): Promise<BrandingPayload> {
  try {
    const res = await http<ApiEnvelope<BrandingPayload>>("/system/branding");
    const appDisplayName = res.data.appDisplayName.trim();
    return { appDisplayName: appDisplayName || APP_DISPLAY_NAME };
  }
  catch {
    return { appDisplayName: APP_DISPLAY_NAME };
  }
}

export function useBranding() {
  const query = useQuery({
    queryKey: brandingKeys.detail,
    queryFn: fetchBranding,
    staleTime: 60_000,
  });

  return {
    ...query,
    appDisplayName: query.data?.appDisplayName ?? APP_DISPLAY_NAME,
  };
}
