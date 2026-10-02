import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { resolveFailure, type FailureAction, type Operation } from "./sessionErrors";

const api = (status: number, slug = "about:blank", errors: { path: string; message: string }[] = []) =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "t",
    requestId: "req-9",
    errors,
  });
const network = () => ApiError.network("req-9", new Error("down"));

type Case = [Operation, string, unknown, FailureAction["type"]];

/** One row per cell of Spec 06.1 §5.8's matrix (plus the generic column). */
const CASES: Case[] = [
  // add exercise
  ["add-exercise", "404", api(404, "not-found"), "unavailable"],
  ["add-exercise", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["add-exercise", "409 exercise-retired", api(409, "exercise-retired"), "retired"],
  ["add-exercise", "422 (not producible)", api(422, "validation-error"), "unconfirmed"],
  ["add-exercise", "500", api(500), "unconfirmed"],
  ["add-exercise", "network", network(), "unconfirmed"],
  // move exercise
  ["move-exercise", "404", api(404, "not-found"), "refetch"],
  ["move-exercise", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["move-exercise", "422 stale position", api(422, "validation-error"), "refetch"],
  ["move-exercise", "500", api(500), "retry"],
  ["move-exercise", "network", network(), "retry"],
  // remove exercise
  ["remove-exercise", "404", api(404, "not-found"), "ok"],
  ["remove-exercise", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["remove-exercise", "500", api(500), "retry"],
  ["remove-exercise", "network", network(), "retry"],
  // create set
  ["create-set", "404", api(404, "not-found"), "gone"],
  ["create-set", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["create-set", "422", api(422, "validation-error"), "fields"],
  ["create-set", "500", api(500), "retry"],
  ["create-set", "network", network(), "retry"],
  // update set
  ["update-set", "404", api(404, "not-found"), "gone"],
  ["update-set", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["update-set", "422", api(422, "validation-error"), "fields"],
  ["update-set", "500", api(500), "retry"],
  // delete set
  ["delete-set", "404", api(404, "not-found"), "ok"],
  ["delete-set", "409 workout-finished", api(409, "workout-finished"), "gone"],
  ["delete-set", "500", api(500), "retry"],
  // finish
  ["finish", "404", api(404, "not-found"), "gone"],
  ["finish", "409 incomplete-working-sets", api(409, "incomplete-working-sets"), "incomplete"],
  ["finish", "409 workout-finished", api(409, "workout-finished"), "finished-check"],
  ["finish", "422", api(422, "validation-error"), "clock"],
  ["finish", "500", api(500), "retry"],
  ["finish", "network", network(), "retry"],
  // discard
  ["discard", "404", api(404, "not-found"), "ok"],
  ["discard", "500", api(500), "retry"],
  ["discard", "network", network(), "retry"],
];

describe("§5.8 — resolveFailure encodes the error matrix", () => {
  it.each(CASES)("%s · %s → %s", (op, _label, error, expected) => {
    expect(resolveFailure(op, error).type).toBe(expected);
  });

  it("a retry carries a static message and the request id for support", () => {
    expect(resolveFailure("create-set", api(500))).toEqual({
      type: "retry",
      text: "Couldn't log set — try again",
      requestId: "req-9",
    });
    expect(resolveFailure("finish", network())).toMatchObject({ text: "Couldn't finish — try again" });
  });

  it("an unconfirmed add carries the check-your-workout message and no retry", () => {
    expect(resolveFailure("add-exercise", api(500))).toEqual({
      type: "unconfirmed",
      text: "Couldn't confirm that exercise was added — check your workout before adding it again",
      requestId: "req-9",
    });
  });

  it("422 field errors are passed through for the set operations", () => {
    const action = resolveFailure("create-set", api(422, "validation-error", [{ path: "weight", message: "Required" }]));
    expect(action).toMatchObject({ type: "fields", fieldErrors: [{ path: "weight", message: "Required" }] });
  });

  it("a value that is not an ApiError is a retryable generic failure, never a throw", () => {
    for (const op of ["add-exercise", "move-exercise", "create-set", "finish", "discard"] as Operation[]) {
      expect(() => resolveFailure(op, new Error("boom"))).not.toThrow();
    }
    expect(resolveFailure("create-set", new Error("boom")).type).toBe("retry");
    expect(resolveFailure("add-exercise", "weird").type).toBe("unconfirmed");
  });

  it("an unrecognised 409 slug is generic, not a guess", () => {
    expect(resolveFailure("finish", api(409, "something-new")).type).toBe("retry");
    expect(resolveFailure("create-set", api(409, "something-new")).type).toBe("retry");
  });
});
