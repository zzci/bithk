import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { ShareDialogHost } from "@/shared/components/share";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { queryClient } from "@/shared/lib/query-client";
import i18n from "./i18n";
// Side-effect import: registers the shareable resources (drive + document)
// into the frontend share registry before the share dialog host mounts.
import "@/shared/components/share/register";

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {children}
          {/* One app-level share dialog every caller drives via useShare(). */}
          <ShareDialogHost />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
