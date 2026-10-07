import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/app-error.js";
import {
  WORKOUT_CURSOR_MAX_LENGTH,
  decodeWorkoutCursor,
  encodeWorkoutCursor,
} from "../../src/repositories/workout-cursor.js";

const ID = "018fcb3e-3b8a-7d6e-9c1a-000000000001";
const token = (payload: unknown) => `v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

function expectInvalid(t: string) {
  try {
    decodeWorkoutCursor(t);
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual([{ path: "cursor", message: "not a valid cursor" }]);
    return;
  }
  throw new Error(`expected ${JSON.stringify(t)} to be rejected`);
}

describe("AC6 — cursor round-trip", () => {
  it("decode(encode(c)) === c, preserving microseconds", () => {
    const c = { startedAtText: "2026-09-01T10:00:00.123457Z", id: ID };
    expect(decodeWorkoutCursor(encodeWorkoutCursor(c))).toEqual(c);
  });
  it("tokens are v1.-prefixed unpadded base64url", () => {
    const t = encodeWorkoutCursor({ startedAtText: "2026-09-01T10:00:00.000000Z", id: ID });
    expect(t.startsWith("v1.")).toBe(true);
    expect(t.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("AC6/AC7 — strict decode: every malformed shape is a 422 on `cursor`", () => {
  it.each([
    ["empty", ""],
    ["no prefix", Buffer.from(JSON.stringify({ s: "2026-09-01T10:00:00.000000Z", i: ID })).toString("base64url")],
    ["wrong prefix", token({ s: "2026-09-01T10:00:00.000000Z", i: ID }).replace("v1.", "v2.")],
    ["bad base64url", "v1.***"],
    ["padding", `${token({ s: "2026-09-01T10:00:00.000000Z", i: ID })}=`],
    ["not JSON", `v1.${Buffer.from("not json").toString("base64url")}`],
    ["array", token(["2026-09-01T10:00:00.000000Z", ID])],
    ["missing key", token({ s: "2026-09-01T10:00:00.000000Z" })],
    ["extra key", token({ s: "2026-09-01T10:00:00.000000Z", i: ID, u: "x" })],
    ["non-string s", token({ s: 1, i: ID })],
    ["millisecond timestamp", token({ s: "2026-09-01T10:00:00.000Z", i: ID })],
    ["offset timestamp", token({ s: "2026-09-01T10:00:00.000000+00:00", i: ID })],
    ["impossible date (Review Focus 1)", token({ s: "2026-13-45T25:61:00.000000Z", i: ID })],
    ["Feb 30", token({ s: "2026-02-30T10:00:00.000000Z", i: ID })],
    ["non-UUID id", token({ s: "2026-09-01T10:00:00.000000Z", i: "not-a-uuid" })],
    ["over-long", `v1.${"A".repeat(WORKOUT_CURSOR_MAX_LENGTH)}`],
  ])("%s", (_label, t) => {
    expectInvalid(t);
  });
});
