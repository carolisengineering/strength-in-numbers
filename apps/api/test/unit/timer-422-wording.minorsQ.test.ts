// Minor 598 — the timer 422 wording the web compares (apps/web/src/features/sectionTimer/timerServerErrors.ts).
import { TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX } from "@sin/core";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";

/**
 * The web shows its "or less" copy for a length field only when the server's message is exactly `must be at most N`
 * (minor 316); any other text reads "Check the timer". The phrase is `normalizeError`'s rewrite of Zod's `too_big`
 * (`src/errors/problem.ts`), so a change of wording there would quietly change the web's copy. These pin it for the
 * two fields, on the two routes that take a timer plan.
 */
const HEADERS = { authorization: "Bearer test-token", "content-type": "application/json" };

const OVER: [field: "roundSeconds" | "capSeconds", timer: Record<string, unknown>, message: string][] = [
  ["roundSeconds", { format: "set_timer", roundSeconds: TIMER_ROUND_SECONDS_MAX + 1, rounds: 5 }, "must be at most 3600"],
  ["capSeconds", { format: "amrap", capSeconds: TIMER_CAP_SECONDS_MAX + 1 }, "must be at most 10800"],
];

describe("minor 598 — the timer 422 wording the web compares (timerServerErrors.ts)", () => {
  it("the limits are the ones the messages name", () => {
    expect([TIMER_ROUND_SECONDS_MAX, TIMER_CAP_SECONDS_MAX]).toEqual([3600, 10800]);
  });

  it.each(OVER)("a routine PUT with %s over its maximum answers exactly its message", async (field, timer, message) => {
    const { app } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    const res = await app.inject({
      method: "PUT",
      url: `/v1/routines/${uuidv7()}`,
      headers: HEADERS,
      payload: {
        name: "Timed",
        notes: null,
        sections: [{ key: "s1", name: "Main", timer }],
        items: [{ exerciseId: uuidv7(), sectionKey: "s1", targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual([{ path: `sections.0.timer.${field}`, message }]);
  });

  it.each(OVER)("a section PATCH with %s over its maximum answers exactly its message", async (field, timer, message) => {
    const { app } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    const res = await app.inject({ method: "PATCH", url: `/v1/workout-sections/${uuidv7()}`, headers: HEADERS, payload: { timer } });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual([{ path: `timer.${field}`, message }]);
  });
});
