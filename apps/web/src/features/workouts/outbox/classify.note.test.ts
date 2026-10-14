import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { classify } from "./classify";

const api = (status: number) => new ApiError({ status, type: "about:blank", title: "t", requestId: "r" });

describe("10.3 AC12 — classify for note ops", () => {
  it.each([
    [api(404), "done"],
    [api(500), "retry"],
    [api(503), "retry"],
    [api(408), "retry"],
    [api(429), "retry"],
    [ApiError.network("r", new TypeError("Failed to fetch")), "retry"],
    [api(409), "fail"],
    [api(422), "fail"],
    [api(403), "fail"],
    [new Error("boom"), "fail"],
  ])("%#", (error, verdict) => {
    expect(classify("note", error)).toBe(verdict);
  });

  it("404 is still a failure for an update (only a delete or a note can be 'done')", () => {
    expect(classify("update", api(404))).toBe("fail");
    expect(classify("delete", api(404))).toBe("done");
  });
});
