// SMTP data layer (FEAT-059): the settings themselves are plain `smtp.*`
// rows written through the generic settings api; this file adds the admin
// action that proves them (backend apps/api/src/modules/notification).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation } from "@tanstack/react-query";
import { http } from "../http";

export type SmtpTestResult = ApiData<"postAdminSmtpTest">;

/** `POST /admin/smtp/test` — mail the calling admin through the configured relay. */
export function useSendSmtpTest(): UseMutationResult<SmtpTestResult, Error, void> {
  return useMutation({
    mutationFn: () => http<ApiEnvelope<SmtpTestResult>>("/admin/smtp/test", { method: "POST" }).then(r => r.data),
  });
}
