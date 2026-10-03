import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../api";
import { reportUnexpected } from "./reportUnexpected";

beforeEach(() => observability.reportError.mockReset());

const api = (status: number, slug = "about:blank") =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "t",
    requestId: "req-1",
  });

describe("AC35 — reportError is for failures nobody can act on and nobody predicted (Spec 06.1 §9)", () => {
  it("reports an unrecognised problem with static { source, op } tags only", () => {
    const error = api(409, "something-new");

    reportUnexpected("create-set", error);

    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(error, { source: "workouts", op: "create-set" });
  });

  it("reports a non-ApiError (a state the matrix does not cover)", () => {
    reportUnexpected("finish", new TypeError("boom"));
    expect(observability.reportError).toHaveBeenCalledWith(expect.any(TypeError), { source: "workouts", op: "finish" });
  });

  it.each([
    ["404", api(404, "not-found")],
    ["409 workout-finished", api(409, "workout-finished")],
    ["409 incomplete-working-sets", api(409, "incomplete-working-sets")],
    ["409 exercise-retired", api(409, "exercise-retired")],
    ["422", api(422, "validation-error")],
    ["500", api(500)],
    ["network", ApiError.network("req-1", new Error("down"))],
    ["401", api(401)],
  ])("does not report an expected failure: %s", (_label, error) => {
    reportUnexpected("create-set", error);
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});
