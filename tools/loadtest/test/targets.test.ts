import { describe, expect, it } from "vitest";
import { resolveTarget } from "../src/plan/targets.ts";

describe("AC6 — the target decides the base URL and the token source", () => {
  it.each([
    ["local", "http://localhost:8080", "dev-idp"],
    ["staging", "https://si-api-ft2f.onrender.com", "auth0"],
    ["prod", undefined, "auth0"],
  ] as const)("%s", (name, baseUrl, tokenSource) => {
    expect(resolveTarget(name)).toEqual({ name, baseUrl, tokenSource });
  });

  it("an unknown target fails fast and lists the valid ones", () => {
    expect(() => resolveTarget("nowhere")).toThrow('Unknown target "nowhere"; use one of local, staging, prod');
  });
});
