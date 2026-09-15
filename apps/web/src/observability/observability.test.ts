import { describe, expect, it } from "vitest";

import { reportError } from "./reportError";
import { track } from "./track";

/**
 * The seams are no-ops by design (Spec 04.1 §9); what matters is that they
 * exist with the 04.0-specified signatures, never throw, and return nothing —
 * so a caller can fire-and-forget from an error path without a try/catch.
 */
describe("observability seams — reportError / track (Spec 04.1 §9)", () => {
  it("reportError accepts any error with or without context and returns undefined", () => {
    expect(reportError(new Error("boom"))).toBeUndefined();
    expect(reportError("a string", { boundary: "root" })).toBeUndefined();
    expect(reportError(undefined)).toBeUndefined();
    expect(reportError(null, {})).toBeUndefined();
  });

  it("track accepts an event name with or without props and returns undefined", () => {
    expect(track("profile_saved")).toBeUndefined();
    expect(track("profile_saved", { fields: 2, ok: true, env: "test" })).toBeUndefined();
  });
});
