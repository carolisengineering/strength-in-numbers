import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure, type EditFailure, type EditOperation } from "./editFailure";

const problem = (status: number, slug = "about:blank", errors?: { path: string; message: string }[]) =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "Title",
    detail: "Test problem",
    requestId: "req-1",
    ...(errors ? { errors } : {}),
  });
const network = ApiError.network("req-2", new TypeError("Failed to fetch"));
const fields = [{ path: "reps", message: "Required" }];

type Case = "404" | "would-be-empty" | "422" | "network" | "500" | "429" | "workout-finished" | "other-409";
const ERRORS: Record<Case, unknown> = {
  "404": problem(404, "not-found"),
  "would-be-empty": problem(409, "workout-would-be-empty"),
  "422": problem(422, "validation-error", fields),
  network,
  "500": problem(500),
  "429": problem(429),
  "workout-finished": problem(409, "workout-finished"),
  "other-409": problem(409, "something-else"),
};

const offline: EditFailure = { type: "message", text: EDIT_COPY.offline, requestId: "req-2", retry: false };
const message = (text: string, retry = false): EditFailure => ({ type: "message", text, requestId: "req-1", retry });

/** §5.4, row by row: every cell a set route can meet. */
const SET_ROWS: [EditOperation, Case, EditFailure][] = [
  ["create-set", "404", { type: "missing", text: EDIT_COPY.exerciseMissing }],
  ["create-set", "would-be-empty", message(EDIT_COPY.retry["create-set"])],
  ["create-set", "422", { type: "fields", fieldErrors: fields, fallback: EDIT_COPY.fieldsFallback["create-set"], requestId: "req-1" }],
  ["create-set", "network", offline],
  ["create-set", "500", message(EDIT_COPY.retry["create-set"])],
  ["create-set", "429", message(EDIT_COPY.retry["create-set"])],
  ["create-set", "workout-finished", message(EDIT_COPY.retry["create-set"])],
  ["create-set", "other-409", message(EDIT_COPY.retry["create-set"])],
  ["update-set", "404", { type: "missing", text: EDIT_COPY.setMissing }],
  ["update-set", "would-be-empty", message(EDIT_COPY.retry["update-set"])],
  ["update-set", "422", { type: "fields", fieldErrors: fields, fallback: EDIT_COPY.fieldsFallback["update-set"], requestId: "req-1" }],
  ["update-set", "network", offline],
  ["update-set", "500", message(EDIT_COPY.retry["update-set"])],
  ["update-set", "429", message(EDIT_COPY.retry["update-set"])],
  ["update-set", "workout-finished", message(EDIT_COPY.retry["update-set"])],
  ["update-set", "other-409", message(EDIT_COPY.retry["update-set"])],
  ["delete-set", "404", { type: "done" }],
  ["delete-set", "would-be-empty", { type: "last-set" }],
  ["delete-set", "422", message(EDIT_COPY.retry["delete-set"])],
  ["delete-set", "network", offline],
  ["delete-set", "500", message(EDIT_COPY.retry["delete-set"])],
  ["delete-set", "429", message(EDIT_COPY.retry["delete-set"])],
  ["delete-set", "workout-finished", message(EDIT_COPY.retry["delete-set"])],
  ["delete-set", "other-409", message(EDIT_COPY.retry["delete-set"])],
];

/** The exercise, note, details and delete-workout rows (exercised on screen by Tasks 6–11). */
const OTHER_ROWS: [EditOperation, Case, EditFailure][] = [
  ["add-exercise", "404", { type: "unavailable" }],
  ["add-exercise", "network", offline],
  ["add-exercise", "500", { type: "unconfirmed", text: EDIT_COPY.unconfirmed, requestId: "req-1" }],
  ["add-exercise", "workout-finished", { type: "unconfirmed", text: EDIT_COPY.unconfirmed, requestId: "req-1" }],
  ["move-exercise", "404", { type: "refetch" }],
  ["move-exercise", "422", { type: "refetch" }],
  ["move-exercise", "network", { ...offline, retry: true }],
  ["move-exercise", "500", message(EDIT_COPY.retry["move-exercise"], true)],
  ["regroup", "404", { type: "refetch" }],
  ["regroup", "network", offline],
  ["regroup", "500", message(EDIT_COPY.retry.regroup)],
  ["remove-exercise", "404", { type: "done" }],
  ["remove-exercise", "would-be-empty", { type: "last-set" }],
  ["remove-exercise", "network", { ...offline, retry: true }],
  ["remove-exercise", "500", message(EDIT_COPY.retry["remove-exercise"], true)],
  ["update-note", "404", { type: "missing", text: EDIT_COPY.exerciseMissing }],
  ["update-note", "422", { type: "fields", fieldErrors: fields, fallback: EDIT_COPY.retry["update-note"], requestId: "req-1" }],
  ["update-note", "network", offline],
  ["update-note", "500", message(EDIT_COPY.retry["update-note"])],
  ["update-details", "404", { type: "vanished" }],
  ["update-details", "422", { type: "fields", fieldErrors: fields, fallback: EDIT_COPY.fieldsFallback["update-details"], requestId: "req-1" }],
  ["update-details", "network", offline],
  ["update-details", "workout-finished", message(EDIT_COPY.retry["update-details"])],
  ["delete-workout", "404", { type: "done" }],
  ["delete-workout", "network", { ...offline, retry: true }],
  ["delete-workout", "500", message(EDIT_COPY.deleteFailed, true)],
];

describe("18.0 AC16 — resolveEditFailure follows §5.4", () => {
  it.each(SET_ROWS)("%s × %s", (op, c, expected) => {
    expect(resolveEditFailure(op, ERRORS[c])).toEqual(expected);
  });

  it.each(OTHER_ROWS)("%s × %s", (op, c, expected) => {
    expect(resolveEditFailure(op, ERRORS[c])).toEqual(expected);
  });

  it("add-exercise 409 exercise-retired → retired", () => {
    expect(resolveEditFailure("add-exercise", problem(409, "exercise-retired"))).toEqual({ type: "retired" });
  });

  it("a non-ApiError is the generic row, never a crash", () => {
    expect(resolveEditFailure("update-set", new Error("boom"))).toEqual({
      type: "message",
      text: EDIT_COPY.retry["update-set"],
      requestId: null,
      retry: false,
    });
  });

  it("no output text echoes the problem's detail", () => {
    for (const [op, c] of [...SET_ROWS, ...OTHER_ROWS]) {
      expect(JSON.stringify(resolveEditFailure(op, ERRORS[c]))).not.toContain("Test problem");
    }
  });
});
