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

// jsdom has the <dialog> element but not its showModal()/close() methods
// (Spec 06.0 §5). The shim only toggles the `open` attribute — enough for
// component tests; real focus trapping and Escape handling are exercised by
// Spec 06.1's Playwright smoke.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}
