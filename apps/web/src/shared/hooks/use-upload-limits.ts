import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export interface UploadLimits {
  /** Per-file cap in bytes. */
  readonly maxFileSize: number;
  /** Per-resource attachment count cap. */
  readonly maxAttachmentsPerResource: number;
  /** Total disk quota in bytes, or null when unlimited. */
  readonly totalQuota: number | null;
  /** True when the backend supports presigned direct upload (S3) (FEAT-044). */
  readonly directUpload: boolean;
}

const FALLBACK: UploadLimits = {
  maxFileSize: 200 * 1024 * 1024,
  maxAttachmentsPerResource: 20,
  totalQuota: null,
  directUpload: false,
};

/**
 * Fetches the server-enforced upload limits so the UI can render hints and
 * gate selection client-side. The query is cached for the session — limits
 * are env-driven and only change on API restart. Falls back to the same
 * defaults the API ships with when the request fails.
 */
export function useUploadLimits(): UploadLimits {
  const { data } = useQuery({
    queryKey: ["system", "upload-limits"],
    queryFn: async () => (await http<{ data: UploadLimits }>("/system/upload-limits")).data,
    staleTime: Infinity,
  });
  return data ?? FALLBACK;
}
