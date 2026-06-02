/* eslint-disable react-refresh/only-export-components -- test-only helper module; fast-refresh constraints do not apply. */
import type { RenderOptions } from "@testing-library/react";
// Shared render helpers for component and hook tests. Wraps the subject in the
// same provider chain the app uses (i18n + TanStack Query + theme) but with a
// fresh, isolated QueryClient per call so caches never leak between tests.
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@/shared/components/theme-provider";
import testI18n from "./i18n";

// Retries and refetch-on-focus are off so tests stay deterministic and fast;
// errors surface immediately as the rejected state instead of being retried.
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  readonly children: ReactNode;
  readonly queryClient: QueryClient;
}

function AllProviders({ children, queryClient }: ProvidersProps) {
  return (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions & { queryClient?: QueryClient } = {},
) {
  const { queryClient = makeTestQueryClient(), ...rest } = options;
  const result = render(ui, {
    wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders>,
    ...rest,
  });
  return { ...result, queryClient };
}

// Wrapper factory for renderHook — pairs a hook with a fresh QueryClient and
// the i18n provider so query/mutation hooks resolve their context.
export function makeWrapper(queryClient: QueryClient = makeTestQueryClient()) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <AllProviders queryClient={queryClient}>{children}</AllProviders>;
  };
}
