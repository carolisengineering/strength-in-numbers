import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";

import { Auth0ProviderWithNavigate } from "../auth/Auth0ProviderWithNavigate";
import { createRouter, makeOnRedirectCallback } from "./router";
import { AppErrorBoundary } from "./RootErrorBoundary";

/**
 * One `QueryClient` for the app (Spec 04.0 §5 / §3 "Provides"). `retry: false` —
 * `RetryScreen` is the user-facing retry (AC10); TanStack auto-retry would also
 * stall the network-error path.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

/**
 * Composition root (Spec 04.0 §5). `<Auth0ProviderWithNavigate>` sits outside
 * `<RouterProvider>`; its `onRedirectCallback` navigates the router object
 * created here. `<QueryClientProvider>` wraps the router so route elements can
 * run the `me` query. `bootstrap()` renders this on the config-valid path.
 */
export function AppRoot() {
  const [router] = useState(createRouter);
  const [queryClient] = useState(createQueryClient);
  const [onRedirectCallback] = useState(() => makeOnRedirectCallback(router));

  return (
    <AppErrorBoundary>
      <Auth0ProviderWithNavigate onRedirectCallback={onRedirectCallback}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </Auth0ProviderWithNavigate>
    </AppErrorBoundary>
  );
}
