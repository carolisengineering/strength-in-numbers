import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api";
import { classify, type Verdict } from "./classify";

const api = (status: number, slug = "about:blank") =>
  new ApiError({ status, type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`, title: "t", requestId: "req" });

describe("10.7 AC36 — classify for round and result", () => {
  const cases: [string, unknown, Verdict][] = [
    ["network", ApiError.network("req", new Error("down")), "retry"],
    ["500", api(500), "retry"],
    ["408", api(408), "retry"],
    ["429", api(429), "retry"],
    ["404", api(404, "not-found"), "done"],
    ["409 section-timer-mismatch", api(409, "section-timer-mismatch"), "fail"],
    ["422", api(422, "validation-error"), "fail"],
    ["400", api(400), "fail"],
  ];
  it.each((["round", "result"] as const).flatMap((kind) => cases.map(([name, error, verdict]) => [kind, name, error, verdict] as const)))(
    "%s: %s → %s",
    (kind, _name, error, verdict) => {
      expect(classify(kind, error)).toBe(verdict);
    },
  );
});
