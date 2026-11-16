import { describe, expect, it } from "vitest";
import { RETIME_MESSAGES } from "@sin/core";
import { ApiError } from "../../../api";
import { classify, isFutureEndedAt } from "./classify";

const PROBLEMS = "https://api.strengthinnumbers.app/problems/";
const api = (status: number, slug = "", errors: { path: string; message: string }[] = []) =>
  new ApiError({ status, type: slug ? `${PROBLEMS}${slug}` : "about:blank", title: "t", requestId: "req-1", errors });
const network = ApiError.network("req-2", new TypeError("Failed to fetch"));
const future = () => api(422, "validation-error", [{ path: "endedAt", message: RETIME_MESSAGES.future }]);

describe("06.7 AC3 — the finish outcome table", () => {
  it.each<[string, unknown, string]>([
    ["409 workout-finished", api(409, "workout-finished"), "reconcile"],
    ["409 incomplete-working-sets", api(409, "incomplete-working-sets"), "fail"],
    ["a network failure", network, "retry"],
    ["500", api(500), "retry"],
    ["503", api(503), "retry"],
    ["408", api(408), "retry"],
    ["429", api(429), "retry"],
    ["422 with the future endedAt field error", future(), "retry"],
    ["422 with another endedAt error", api(422, "validation-error", [{ path: "endedAt", message: RETIME_MESSAGES.beforeStart }]), "fail"],
    ["422 with the future message on another path", api(422, "validation-error", [{ path: "startedAt", message: RETIME_MESSAGES.future }]), "fail"],
    ["422 with no field errors", api(422, "validation-error"), "fail"],
    ["404", api(404, "not-found"), "fail"],
    ["400", api(400), "fail"],
    ["a non-ApiError", new Error("boom"), "fail"],
  ])("finish + %s → %s", (_name, error, verdict) => {
    expect(classify("finish", error)).toBe(verdict);
    expect(classify("finish", error, { finishWaiting: true })).toBe(verdict);
  });

  it("isFutureEndedAt matches only the static future message on endedAt, among other field errors too", () => {
    expect(isFutureEndedAt(future())).toBe(true);
    expect(
      isFutureEndedAt(api(422, "validation-error", [{ path: "notes", message: "x" }, { path: "endedAt", message: RETIME_MESSAGES.future }])),
    ).toBe(true);
    expect(isFutureEndedAt(api(422, "validation-error"))).toBe(false);
    expect(isFutureEndedAt(new Error("x"))).toBe(false);
  });

  it("a 409 workout-finished on any other kind stays fail (rollback-only, Spec 18.0 AC26)", () => {
    expect(classify("create", api(409, "workout-finished"))).toBe("fail");
    expect(classify("note", api(409, "workout-finished"))).toBe("fail");
  });
});

describe("06.7 AC6 — a 404 on a note, round or result op is not done while a finish waits", () => {
  it.each(["note", "round", "result"] as const)("%s: 404 → fail with a finish waiting, done without", (kind) => {
    expect(classify(kind, api(404), { finishWaiting: true })).toBe("fail");
    expect(classify(kind, api(404), { finishWaiting: false })).toBe("done");
    expect(classify(kind, api(404))).toBe("done");
  });

  it("a 404 on a set delete stays done either way", () => {
    expect(classify("delete", api(404), { finishWaiting: true })).toBe("done");
    expect(classify("delete", api(404))).toBe("done");
  });
});
