import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { ROUND_LENGTH_MAX_ERROR, TIMER_CHECK_ERROR } from "../../sectionTimer/timerCopy";
import { SECTION_COPY } from "./sectionCopy";
import { resolveSectionFailure } from "./resolveSectionFailure";

const api = (status: number, slug = "about:blank", errors?: { path: string; message: string }[]) =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "t",
    requestId: "req-9",
    ...(errors ? { errors } : {}),
  });
const resolve = (op: Parameters<typeof resolveSectionFailure>[0], error: unknown) => resolveSectionFailure(op, error, { offlineText: "off" });

describe("10.7 AC18 — 409 section-result-exists", () => {
  it("on update is the stale-screen row", () => {
    expect(resolve("update-section", api(409, "section-result-exists"))).toStrictEqual({
      type: "result-exists",
      text: "Times were logged for this section. Check them and try again.",
      report: false,
    });
  });

  it("on another op it is not that row", () => {
    expect(resolve("remove-section", api(409, "section-result-exists")).type).toBe("retry");
  });
});

describe("10.7 AC25 — failure table, timer rows", () => {
  it("a 422 on timer.roundSeconds sits under the round length", () => {
    expect(resolve("update-section", api(422, "validation-error", [{ path: "timer.roundSeconds", message: "SERVER-SECRET" }]))).toStrictEqual({
      type: "fields",
      name: null,
      notes: null,
      timer: { roundSeconds: ROUND_LENGTH_MAX_ERROR },
      report: false,
    });
  });

  it("a 422 on timer itself sits under the group", () => {
    const out = resolve("add-section", api(422, "validation-error", [{ path: "timer", message: "SERVER-SECRET" }]));
    expect(out).toMatchObject({ type: "fields", timer: { group: TIMER_CHECK_ERROR } });
    expect(JSON.stringify(out)).not.toContain("SERVER-SECRET");
  });

  it("a 422 on name and timer fills both", () => {
    expect(resolve("update-section", api(422, "validation-error", [{ path: "name", message: "x" }, { path: "timer.rounds", message: "x" }]))).toMatchObject({
      name: SECTION_COPY.fieldsGeneric,
      timer: { rounds: "Rounds go from 1 to 100." },
    });
  });

  it("409 section-timer-mismatch falls to the generic retry row, reported", () => {
    expect(resolve("update-section", api(409, "section-timer-mismatch"))).toStrictEqual({
      type: "retry",
      text: SECTION_COPY.saveFailed,
      requestId: "req-9",
      offerRetry: false,
      report: true,
    });
  });
});
