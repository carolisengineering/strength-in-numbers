import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { SECTION_COPY, rateLimited } from "./sectionCopy";
import { resolveSectionFailure, type SectionOp } from "./resolveSectionFailure";

const api = (
  status: number,
  slug = "about:blank",
  extra: { errors?: { path: string; message: string }[]; retryAfterMs?: number | null } = {},
) =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "t",
    requestId: "req-9",
    ...extra,
  });
const network = () => ApiError.network("req-9", new Error("down"));
const OFFLINE = "You're offline";
const resolve = (op: SectionOp, error: unknown) => resolveSectionFailure(op, error, { offlineText: OFFLINE });
const OPS: SectionOp[] = ["add-section", "update-section", "remove-section", "set-section"];

describe("10.6 AC13 — resolveSectionFailure", () => {
  it.each(OPS)("%s: a network error is offline with the given text, not reported", (op) => {
    expect(resolve(op, network())).toStrictEqual({ type: "offline", text: OFFLINE, report: false });
  });

  it.each(OPS)("%s: a 429 is the rate-limit text, Retry-After used, not reported", (op) => {
    expect(resolve(op, api(429))).toStrictEqual({ type: "rate-limited", text: rateLimited(null), report: false });
    expect(resolve(op, api(429, "about:blank", { retryAfterMs: 5000 }))).toStrictEqual({
      type: "rate-limited",
      text: rateLimited(5000),
      report: false,
    });
  });

  it("a 422 on name maps to the generic field text; on notes too; with no path the form text", () => {
    expect(resolve("add-section", api(422, "validation-error", { errors: [{ path: "name", message: "x" }] }))).toStrictEqual({
      type: "fields",
      name: SECTION_COPY.fieldsGeneric,
      notes: null,
      report: false,
    });
    expect(resolve("update-section", api(422, "validation-error", { errors: [{ path: "notes", message: "x" }] }))).toStrictEqual({
      type: "fields",
      name: null,
      notes: SECTION_COPY.fieldsGeneric,
      report: false,
    });
    expect(resolve("add-section", api(422, "validation-error"))).toStrictEqual({
      type: "fields",
      name: null,
      notes: null,
      report: false,
    });
  });

  it("409 workout-section-limit on add is the limit text", () => {
    expect(resolve("add-section", api(409, "workout-section-limit"))).toStrictEqual({
      type: "limit",
      text: SECTION_COPY.limit,
      report: false,
    });
  });

  it("a 404 is workout-gone on add, missing on update and move, done on remove", () => {
    expect(resolve("add-section", api(404, "not-found"))).toStrictEqual({ type: "workout-gone", report: false });
    expect(resolve("update-section", api(404, "not-found"))).toStrictEqual({ type: "missing", report: false });
    expect(resolve("set-section", api(404, "not-found"))).toStrictEqual({ type: "missing", report: false });
    expect(resolve("remove-section", api(404, "not-found"))).toStrictEqual({ type: "done", report: false });
  });

  it("a 500 is unconfirmed on add and a retry elsewhere, each with its request id", () => {
    expect(resolve("add-section", api(500))).toStrictEqual({
      type: "unconfirmed",
      text: SECTION_COPY.addUnconfirmed,
      requestId: "req-9",
      report: false,
    });
    expect(resolve("update-section", api(500))).toStrictEqual({
      type: "retry",
      text: SECTION_COPY.saveFailed,
      requestId: "req-9",
      offerRetry: false,
      report: false,
    });
    expect(resolve("remove-section", api(500))).toStrictEqual({
      type: "retry",
      text: SECTION_COPY.removeFailed,
      requestId: "req-9",
      offerRetry: true,
      report: false,
    });
    expect(resolve("set-section", api(500))).toStrictEqual({
      type: "retry",
      text: SECTION_COPY.moveFailed,
      requestId: "req-9",
      offerRetry: true,
      report: false,
    });
  });

  it("a 409 with an unknown slug is a retry and is reported", () => {
    expect(resolve("set-section", api(409, "something-else"))).toMatchObject({
      type: "retry",
      text: SECTION_COPY.moveFailed,
      report: true,
    });
  });

  it("a non-ApiError is reported, with no request id", () => {
    expect(resolve("add-section", new Error("boom"))).toStrictEqual({
      type: "unconfirmed",
      text: SECTION_COPY.addUnconfirmed,
      requestId: null,
      report: true,
    });
  });

  it("409 workout-section-limit on another op is not the limit (it cannot occur there) — a retry", () => {
    expect(resolve("update-section", api(409, "workout-section-limit"))).toMatchObject({ type: "retry" });
  });
});
