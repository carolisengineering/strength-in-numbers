import { describe, expect, it } from "vitest";

import { ApiError } from "../../api/problem";
import { isSessionEnded } from "./accountDeleted";

const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: 500, type: "about:blank", title: "t", requestId: "req-1", ...init });

describe("12 AC10 — a session that is ending shows no notice", () => {
  it("a second 401 is an ended session", () => {
    expect(isSessionEnded(api({ status: 401 }))).toBe(true);
  });
  it("a lost-session token failure (status 0, not a network error) is an ended session", () => {
    expect(isSessionEnded(api({ status: 0, title: "Session expired", isNetworkError: false }))).toBe(true);
  });
  it("offline, a 500 and a non-ApiError are not", () => {
    expect(isSessionEnded(api({ status: 0, isNetworkError: true }))).toBe(false);
    expect(isSessionEnded(api({ status: 500 }))).toBe(false);
    expect(isSessionEnded(new Error("x"))).toBe(false);
  });
});
