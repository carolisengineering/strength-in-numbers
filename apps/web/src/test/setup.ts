import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw/server";

// `vitest` runs with `globals: false`, so React Testing Library's automatic
// per-test unmount is not registered — do it here for every render test.
afterEach(() => {
  cleanup();
});

// Shared MSW lifecycle (Spec 04.0 §10). `error` on an unhandled request keeps a
// missing `server.use(...)` from silently hitting the network.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
