import { describe, expect, it } from "vitest";

import { ApiError } from "../../api/problem";
import { deleteFailure, exportFailure } from "./failureCopy";

const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: 500, type: "about:blank", title: "t", requestId: "req-9", ...init });

describe("12 AC9 — export failure copy", () => {
  it.each([
    ["offline", api({ status: 0, isNetworkError: true }), "You're offline. Connect and try again.", undefined],
    ["429 with Retry-After 1500 ms rounds up", api({ status: 429, retryAfterMs: 1500 }), "Too many downloads. Try again in 2 seconds.", undefined],
    ["429 with Retry-After 1000 ms is singular", api({ status: 429, retryAfterMs: 1000 }), "Too many downloads. Try again in 1 second.", undefined],
    ["429 without Retry-After", api({ status: 429, retryAfterMs: null }), "Too many downloads. Try again in a minute.", undefined],
    ["5xx", api({ status: 503 }), "Couldn't prepare your data.", "req-9"],
    ["non-ApiError (saveBlob threw)", new Error("blocked"), "Couldn't prepare your data.", undefined],
  ])("%s", (_n, error, text, requestId) => {
    expect(exportFailure(error)).toEqual(requestId ? { text, requestId } : { text });
  });

  it("never echoes the response body or an error message", () => {
    const out = exportFailure(api({ status: 500, detail: "secret@example.com", title: "leak" }));
    expect(JSON.stringify(out)).not.toMatch(/secret|leak/);
  });
});

describe("12 AC19 — delete failure copy", () => {
  it.each([
    ["offline", api({ status: 0, isNetworkError: true }), "You're offline. Connect and try again.", undefined],
    ["429", api({ status: 429, retryAfterMs: 3000 }), "Too many attempts. Try again in 3 seconds.", undefined],
    ["other", api({ status: 500 }), "Couldn't delete your account.", "req-9"],
  ])("%s", (_n, error, text, requestId) => {
    expect(deleteFailure(error)).toEqual(requestId ? { text, requestId } : { text });
  });
});
