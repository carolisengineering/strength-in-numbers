import { describe, expect, it } from "vitest";
import { ignoreNotFound, isNotFound } from "./notFound";
import { ApiError } from "./problem";

const apiError = (status: number) => new ApiError({ status, type: "about:blank", title: "t", requestId: "r" });

describe("Minor 234 — isNotFound", () => {
  it("is true only for an ApiError with status 404", () => {
    expect(isNotFound(apiError(404))).toBe(true);
    expect(isNotFound(apiError(409))).toBe(false);
    expect(isNotFound(new TypeError("404"))).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe("Minor 68 — one ignoreNotFound", () => {
  it("a 404 is done: it resolves", async () => {
    await expect(ignoreNotFound(() => Promise.reject(apiError(404)))).resolves.toBeUndefined();
  });
  it("anything else is rethrown: a 409, a 500 and a TypeError", async () => {
    for (const failure of [apiError(409), apiError(500), new TypeError("Failed to fetch")]) {
      await expect(ignoreNotFound(() => Promise.reject(failure))).rejects.toBe(failure);
    }
  });
  it("a success resolves", async () => {
    await expect(ignoreNotFound(() => Promise.resolve())).resolves.toBeUndefined();
  });
});
