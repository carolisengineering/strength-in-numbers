import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/node/args.ts";

describe("parseArgs", () => {
  it("run gym on local, with defaults", () => {
    expect(parseArgs(["run", "gym", "--target", "local"])).toEqual({
      cmd: "run",
      type: "gym",
      target: "local",
      dryRun: false,
      push: 1,
      allowUnpassedPush: false,
      metricsOutput: true,
    });
  });

  it("run push with a factor, a dry run, lifters and dev-only step and hold overrides", () => {
    expect(
      parseArgs(["run", "push", "--target", "local", "--push", "4", "--dry-run", "--lifters", "3", "--steps", "1,2,3", "--hold-scale", "0.05"]),
    ).toMatchObject({ cmd: "run", type: "push", push: 4, dryRun: true, lifters: 3, steps: [1, 2, 3], holdScale: 0.05 });
  });

  it("push needs a factor above 1; gym and burst refuse one", () => {
    expect(() => parseArgs(["run", "push", "--target", "local"])).toThrow(/--push/);
    expect(() => parseArgs(["run", "gym", "--target", "local", "--push", "2"])).toThrow(/--push/);
  });

  it("AC6 — an unknown target fails with the list", () => {
    expect(() => parseArgs(["run", "gym", "--target", "nowhere"])).toThrow('Unknown target "nowhere"; use one of local, staging, prod');
  });

  it("Phase A refuses prod and staging", () => {
    expect(() => parseArgs(["run", "gym", "--target", "prod"])).toThrow("prod is not wired yet (Spec 16 Phase B)");
    expect(() => parseArgs(["cleanup", "--target", "staging"])).toThrow("staging is not wired yet (Spec 16 Phase B)");
  });

  it("the dev-only --steps and --hold-scale are local only", () => {
    expect(() => parseArgs(["run", "gym", "--target", "staging", "--steps", "1,2"])).toThrow();
  });

  it("cleanup and seed take a target and an optional lifter count", () => {
    expect(parseArgs(["cleanup", "--target", "local", "--lifters", "5"])).toEqual({ cmd: "cleanup", target: "local", lifters: 5 });
    expect(parseArgs(["seed", "--target", "local"])).toEqual({ cmd: "seed", target: "local" });
  });

  it("rejects unknown commands, run types and flags", () => {
    expect(() => parseArgs(["launch"])).toThrow(/usage/);
    expect(() => parseArgs(["run", "sprint", "--target", "local"])).toThrow(/gym, push or burst/);
    expect(() => parseArgs(["run", "gym", "--target", "local", "--fast"])).toThrow(/--fast/);
    expect(() => parseArgs(["run", "gym", "--target", "local", "--lifters", "0"])).toThrow(/--lifters/);
  });
});
