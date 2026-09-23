import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WORKOUT_NOTES_MAX } from "@sin/core";
import { buildTestApp } from "../helpers/build-test-app.js";

const BEARER = { authorization: "Bearer test-token" };

// `assertStartedAtInBounds` checks `startedAt` against the real wall clock
// (±5min future / -7days past), so fixture timestamps must be relative to
// "now" rather than a fixed literal — a fixed date drifts out of the past
// bound as real time passes (see routes-workouts.test.ts).
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago

describe("AC16 — free-text bound is 422, never 413, even near the body limit", () => {
  it("a notes field one char over the max, sent as \\uXXXX escapes (~24KB on the wire), is 422 naming the field", async () => {
    const { app } = await buildTestApp();
    const overLong = "a".repeat(WORKOUT_NOTES_MAX + 1);
    const escaped = [...overLong].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const rawBody = `{"clientGeneratedId":"${uuidv7()}","startedAt":"${STARTED_AT}","notes":"${escaped}"}`;
    expect(Buffer.byteLength(rawBody, "utf8")).toBeLessThan(64 * 1024); // under BODY_LIMIT_BYTES

    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: { ...BEARER, "content-type": "application/json" },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(422);
    expect(res.statusCode).not.toBe(413);
  });

  it("exactly WORKOUT_NOTES_MAX characters is accepted (201)", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: {
        clientGeneratedId: uuidv7(),
        startedAt: STARTED_AT,
        notes: "a".repeat(WORKOUT_NOTES_MAX),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("a title containing <script> round-trips byte-for-byte (format check, not an HTML filter)", async () => {
    const { app } = await buildTestApp();
    const title = "<script>alert(1)</script>";
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, title },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe(title);
  });
});
