import { describe, expect, it } from "vitest";
import { buildThresholds, thresholdsMatching } from "../src/plan/thresholds.ts";

describe("AC7 — thresholds express X directly, per step", () => {
  it("gym: exact k6 threshold strings for two steps", () => {
    expect(buildThresholds(2, "gym")).toEqual({
      "http_req_duration{name:set_save,phase:measure,step:1}": ["p(95)<2000"],
      "server_errors{phase:measure,step:1}": ["rate<0.01"],
      "rate_limited{phase:measure,step:1}": ["count<1"],
      "http_req_duration{name:set_save,phase:measure,step:2}": ["p(95)<2000"],
      "server_errors{phase:measure,step:2}": ["rate<0.01"],
      "rate_limited{phase:measure,step:2}": ["count<1"],
    });
  });

  it("burst: no set saves happen, so only 5xx and 429 judge a step", () => {
    expect(buildThresholds(1, "burst")).toEqual({
      "server_errors{phase:measure,step:1}": ["rate<0.01"],
      "rate_limited{phase:measure,step:1}": ["count<1"],
    });
  });
});

describe("AC10 — warm-up is excluded", () => {
  const thresholds = buildThresholds(3, "gym");

  it("a 30 s warm-up set save matches no threshold", () => {
    expect(thresholdsMatching(thresholds, "http_req_duration", { name: "set_save", phase: "warmup", step: "warmup" })).toEqual([]);
    expect(thresholdsMatching(thresholds, "server_errors", { name: "warmup_healthz", phase: "warmup", step: "warmup" })).toEqual([]);
  });

  it("a ramp request matches none either; a measured one matches exactly its step", () => {
    expect(thresholdsMatching(thresholds, "http_req_duration", { name: "set_save", phase: "ramp", step: "ramp" })).toEqual([]);
    expect(thresholdsMatching(thresholds, "http_req_duration", { name: "set_save", phase: "measure", step: "2" })).toEqual([
      "http_req_duration{name:set_save,phase:measure,step:2}",
    ]);
  });
});
