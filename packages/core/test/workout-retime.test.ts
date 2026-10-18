import { describe, expect, it } from "vitest";
import { resolveRetime, WORKOUT_DURATION_MAX_S, WORKOUT_START_EDIT_FLOOR, type RetimeCurrent } from "../src/index.js";

const NOW = new Date("2026-10-18T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();

const live = (startMs: number, plan: number | null = null): RetimeCurrent => ({ startedAt: at(startMs), endedAt: null, plannedDurationS: plan });
const finished = (startMs: number, durMs: number): RetimeCurrent => ({ startedAt: at(startMs), endedAt: at(startMs + durMs), plannedDurationS: null });

describe("07.4 AC23 — the start bound applies only to a changed start", () => {
  it("constants", () => {
    expect(WORKOUT_DURATION_MAX_S).toBe(86_400);
    expect(WORKOUT_START_EDIT_FLOOR).toBe("2000-01-01T00:00:00Z");
  });

  it("a changed start more than 5 minutes ahead is refused on startedAt", () => {
    expect(resolveRetime(live(-HOUR), { startedAt: iso(5 * MIN + 1) }, NOW)).toEqual({
      ok: false, path: "startedAt", message: "must not be more than 5 minutes in the future",
    });
  });

  it("a changed start before the floor is refused; the floor itself is accepted", () => {
    expect(resolveRetime(live(-HOUR), { startedAt: "1999-12-31T23:59:59.999Z" }, NOW)).toEqual({
      ok: false, path: "startedAt", message: "must not be before 2000-01-01",
    });
    const r = resolveRetime(live(-HOUR), { startedAt: "2000-01-01T00:00:00Z" }, NOW);
    expect(r).toMatchObject({ ok: true, startChanged: true });
    if (r.ok) expect(r.startedAt.toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });

  it("an echoed start is no change and skips the bound check, even below the floor", () => {
    const old: RetimeCurrent = { startedAt: new Date("1990-01-01T00:00:00Z"), endedAt: new Date("1990-01-01T01:00:00Z"), plannedDurationS: null };
    expect(resolveRetime(old, { startedAt: "1990-01-01T00:00:00.000Z" }, NOW)).toMatchObject({ ok: true, startChanged: false, endChanged: false });
  });
});

describe("07.4 AC20 — a live workout's planned duration", () => {
  it("stores a plan whose end is in the past, and null clears it", () => {
    expect(resolveRetime(live(-2 * HOUR), { durationSeconds: 3600 }, NOW)).toMatchObject({ ok: true, plannedDurationS: 3600, endedAt: null });
    expect(resolveRetime(live(-2 * HOUR, 3600), { durationSeconds: null }, NOW)).toMatchObject({ ok: true, plannedDurationS: null });
  });

  it("keeps the stored plan when the key is absent", () => {
    expect(resolveRetime(live(-2 * HOUR, 1800), { startedAt: iso(-3 * HOUR) }, NOW)).toMatchObject({ ok: true, plannedDurationS: 1800, startChanged: true });
  });

  it("a plan ending more than 5 minutes ahead is refused on durationSeconds", () => {
    expect(resolveRetime(live(-30 * MIN), { durationSeconds: 3600 }, NOW)).toEqual({
      ok: false, path: "durationSeconds", message: "would end in the future",
    });
  });

  it("Review Focus 3 — moving the start so the stored plan ends in the future is refused on startedAt", () => {
    expect(resolveRetime(live(-2 * HOUR, 3600), { startedAt: iso(-30 * MIN) }, NOW)).toEqual({
      ok: false, path: "startedAt", message: "would end in the future",
    });
  });
});

describe("07.4 AC21 — finishing a live workout", () => {
  it("a finish sets the end and clears the plan", () => {
    const r = resolveRetime(live(-2 * HOUR, 3600), { endedAt: iso(-HOUR) }, NOW);
    expect(r).toMatchObject({ ok: true, plannedDurationS: null, endChanged: true, startChanged: false });
    if (r.ok) expect(r.endedAt?.toISOString()).toBe(iso(-HOUR));
  });

  it("the end is checked against the moved start", () => {
    expect(resolveRetime(live(-3 * HOUR), { startedAt: iso(-HOUR), endedAt: iso(-HOUR - 1) }, NOW)).toEqual({
      ok: false, path: "endedAt", message: "must not be before startedAt",
    });
  });

  it("an end more than 5 minutes ahead is refused on endedAt", () => {
    expect(resolveRetime(live(-HOUR), { endedAt: iso(5 * MIN + 1) }, NOW)).toEqual({
      ok: false, path: "endedAt", message: "must not be more than 5 minutes in the future",
    });
  });
});

describe("07.4 AC22 — Change Time on a finished workout", () => {
  it("a moved start carries the end with it (duration kept)", () => {
    const r = resolveRetime(finished(-2 * DAY, HOUR), { startedAt: iso(-3 * DAY) }, NOW);
    expect(r).toMatchObject({ ok: true, startChanged: true, endChanged: true, plannedDurationS: null });
    if (r.ok) expect(r.endedAt?.toISOString()).toBe(iso(-3 * DAY + HOUR));
  });

  it("a duration sets the end from the start; zero is allowed", () => {
    const r = resolveRetime(finished(-DAY, HOUR), { durationSeconds: 0 }, NOW);
    expect(r).toMatchObject({ ok: true, startChanged: false, endChanged: true });
    if (r.ok) expect(r.endedAt?.toISOString()).toBe(iso(-DAY));
  });

  it("start and duration together set both", () => {
    const r = resolveRetime(finished(-DAY, HOUR), { startedAt: iso(-2 * DAY), durationSeconds: 1800 }, NOW);
    if (!r.ok) throw new Error("expected ok");
    expect(r.startedAt.toISOString()).toBe(iso(-2 * DAY));
    expect(r.endedAt?.toISOString()).toBe(iso(-2 * DAY + 30 * MIN));
  });

  it("durationSeconds: null is refused", () => {
    expect(resolveRetime(finished(-DAY, HOUR), { durationSeconds: null }, NOW)).toEqual({
      ok: false, path: "durationSeconds", message: "not allowed on a finished workout",
    });
  });

  it("a move that pushes the kept end into the future is refused on startedAt; a long duration on durationSeconds", () => {
    expect(resolveRetime(finished(-DAY, HOUR), { startedAt: iso(-10 * MIN) }, NOW)).toEqual({
      ok: false, path: "startedAt", message: "would end in the future",
    });
    expect(resolveRetime(finished(-HOUR, 30 * MIN), { durationSeconds: 7200 }, NOW)).toEqual({
      ok: false, path: "durationSeconds", message: "would end in the future",
    });
  });

  it("an empty patch changes nothing", () => {
    expect(resolveRetime(finished(-DAY, HOUR), {}, NOW)).toMatchObject({ ok: true, startChanged: false, endChanged: false });
  });
});
