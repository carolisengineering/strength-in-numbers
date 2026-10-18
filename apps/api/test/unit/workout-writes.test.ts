import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/app-error.js";
import {
  assertAddPositionInRange,
  assertReorderPositionInRange,
  assertStartedAtInBounds,
  computeAppendPosition,
  retimeOrThrow,
} from "../../src/repositories/workout-writes.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("AC7 — assertStartedAtInBounds", () => {
  it("accepts exactly at the +5 minute future bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000), NOW),
    ).not.toThrow();
  });
  it("rejects just past the +5 minute future bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000 + 1), NOW),
    ).toThrow(ValidationError);
  });
  it("accepts exactly at the -7 day past bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), NOW),
    ).not.toThrow();
  });
  it("rejects just past the -7 day past bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1), NOW),
    ).toThrow(ValidationError);
  });
});

// Amended by 07.4: the finish's endedAt rules now run in `resolveRetime`, through `retimeOrThrow`.
describe("AC7/AC8 — a finish's endedAt future bound", () => {
  const live = { startedAt: new Date(NOW.getTime() - 3_600_000), endedAt: null, plannedDurationS: null };
  it("accepts exactly at the +5 minute future bound and rejects just past it", () => {
    expect(() => retimeOrThrow(live, { endedAt: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString() }, NOW)).not.toThrow();
    expect(() => retimeOrThrow(live, { endedAt: new Date(NOW.getTime() + 5 * 60 * 1000 + 1).toISOString() }, NOW)).toThrow(ValidationError);
  });
});

describe("AC8 — a finish's endedAt is not before startedAt", () => {
  const startedAt = new Date("2026-09-15T10:00:00.000Z");
  const live = { startedAt, endedAt: null, plannedDurationS: null };
  it("accepts endedAt === startedAt", () => {
    expect(() => retimeOrThrow(live, { endedAt: startedAt.toISOString() }, NOW)).not.toThrow();
  });
  it("rejects endedAt < startedAt", () => {
    expect(() => retimeOrThrow(live, { endedAt: new Date(startedAt.getTime() - 1).toISOString() }, NOW)).toThrow(ValidationError);
  });
});

describe("AC11 — computeAppendPosition", () => {
  it("returns n (append at the end)", () => {
    expect(computeAppendPosition(0)).toBe(0);
    expect(computeAppendPosition(5)).toBe(5);
  });
});

describe("AC11 — assertAddPositionInRange (0 <= position <= n)", () => {
  it("accepts the boundaries", () => {
    expect(() => assertAddPositionInRange(0, 3)).not.toThrow();
    expect(() => assertAddPositionInRange(3, 3)).not.toThrow();
  });
  it("rejects position = n + 1", () => {
    expect(() => assertAddPositionInRange(4, 3)).toThrow(ValidationError);
  });
  it("rejects a position above the smallint ceiling without ever reaching Postgres", () => {
    expect(() => assertAddPositionInRange(40_000, 3)).toThrow(ValidationError);
  });
});

describe("AC11 — assertReorderPositionInRange (0 <= position <= n-1)", () => {
  it("accepts the boundaries", () => {
    expect(() => assertReorderPositionInRange(0, 3)).not.toThrow();
    expect(() => assertReorderPositionInRange(2, 3)).not.toThrow();
  });
  it("rejects position = n", () => {
    expect(() => assertReorderPositionInRange(3, 3)).toThrow(ValidationError);
  });
});
