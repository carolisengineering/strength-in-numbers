import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { backoffMs, classify, failureOf, isNetworkFailure } from "./classify";

const api = (status: number, type = "about:blank") => new ApiError({ status, type, title: "t", requestId: "req-1" });
const network = ApiError.network("req-2", new TypeError("Failed to fetch"));
const badBody = new ApiError({ status: 0, type: "about:blank", title: "Invalid request body", requestId: "r", isNetworkError: false });

describe("06.2 AC5 — one table classifies every outcome", () => {
  it.each([
    ["create", network, "retry"],
    ["update", api(500), "retry"],
    ["delete", api(503), "retry"],
    ["create", api(408), "retry"],
    ["create", api(429), "retry"],
    ["delete", api(404), "done"],
    ["create", api(404), "fail"],
    ["update", api(404), "fail"],
    ["update", api(409, "https://x/problems/workout-finished"), "fail"],
    ["create", api(422, "https://x/problems/validation-error"), "fail"],
    ["create", api(400), "fail"],
    ["create", badBody, "fail"],
    ["create", new Error("not an ApiError"), "fail"],
  ] as const)("%s + %o → %s", (kind, error, verdict) => {
    expect(classify(kind, error)).toBe(verdict);
  });

  it("backoff doubles from 1 s and caps at 30 s, with ±20 % jitter", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((a) => backoffMs(a, mid))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffMs(1, () => 0)).toBe(800);
    expect(backoffMs(1, () => 1)).toBe(1200);
  });

  it("isNetworkFailure is true only for a network ApiError", () => {
    expect(isNetworkFailure(network)).toBe(true);
    expect(isNetworkFailure(api(500))).toBe(false);
    expect(isNetworkFailure(new Error("x"))).toBe(false);
  });

  it("failureOf keeps status, slug and request id", () => {
    expect(failureOf(api(409, "https://x/problems/workout-finished"))).toEqual({
      status: 409,
      type: "workout-finished",
      requestId: "req-1",
    });
    expect(failureOf(new Error("x"))).toEqual({ status: 0, type: "unknown", requestId: null });
  });
});
