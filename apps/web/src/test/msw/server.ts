import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/**
 * Shared MSW server for the Vitest suite (Spec 04.0 §10 — the API client is
 * tested against real `Response` objects, incl. `application/problem+json`, with
 * no live network). Lifecycle hooks live in `src/test/setup.ts`.
 */
export const server = setupServer(...handlers);
