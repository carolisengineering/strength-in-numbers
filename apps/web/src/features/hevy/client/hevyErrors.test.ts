import { describe, expect, it } from "vitest";
import { HEVY_COPY } from "../messages";
import { classifyHevyResponse, HevyError, parseRetryAfter, type HevyErrorKind } from "./hevyErrors";

describe("20.0 AC9 — error kinds", () => {
  const rows: [number, unknown, HevyErrorKind][] = [
    [401, null, "bad_key"],
    [403, { error: "exceeds-custom-exercise-limit" }, "limit"],
    [403, { error: "something else" }, "bad_key"],
    [403, null, "bad_key"],
    [429, null, "rate_limited"],
    [400, { error: "Invalid title" }, "rejected"],
    [404, { error: "User not found" }, "not_found"],
    [500, null, "server"],
    [503, null, "server"],
  ];
  it.each(rows)("%i %j is %s", (status, body, kind) => {
    expect(classifyHevyResponse(status, body)).toBe(kind);
  });
});

describe("20.0 AC9 — static copy", () => {
  it("a HevyError never carries anything from Hevy's reply", () => {
    const body = { error: "Invalid title 'K3Y-PLANTED'" };
    const err = new HevyError(classifyHevyResponse(400, body), { status: 400 });
    expect(err.name).toBe("HevyError");
    expect(err.message).toBe("Hevy request failed: rejected");
    expect(err.kind).toBe("rejected");
    expect(err.status).toBe(400);
    expect(err.retryAfterMs).toBeNull();
    for (const text of [err.message, err.name, err.stack ?? ""]) expect(text).not.toContain("K3Y-PLANTED");
    expect("cause" in err).toBe(false);
  });

  it("every kind has a non-empty sentence", () => {
    const kinds: HevyErrorKind[] = ["bad_key", "limit", "rate_limited", "rejected", "not_found", "server", "network", "unexpected_reply", "aborted"];
    for (const k of kinds) expect(HEVY_COPY[k].length).toBeGreaterThan(0);
    expect(Object.keys(HEVY_COPY).sort()).toEqual([...kinds].sort());
  });
});

describe("20.0 AC10 — Retry-After", () => {
  const t = Date.parse("2026-10-28T12:00:00.000Z");
  it("reads seconds and HTTP dates, and gives null for anything else", () => {
    expect(parseRetryAfter("7", t)).toBe(7000);
    expect(parseRetryAfter(new Date(t + 7000).toUTCString(), t)).toBe(7000);
    expect(parseRetryAfter("soon", t)).toBeNull();
    expect(parseRetryAfter(null, t)).toBeNull();
    expect(parseRetryAfter(new Date(t - 60_000).toUTCString(), t)).toBe(0);
  });
});
