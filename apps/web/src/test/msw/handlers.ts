import type { RequestHandler } from "msw";

/**
 * Default MSW handlers. Empty by design — the API client suite registers
 * per-test handlers with `server.use(...)` and the shared server is configured
 * `onUnhandledRequest: "error"`, so an un-mocked request fails loudly.
 */
export const handlers: RequestHandler[] = [];
