import { describe, expect, it } from "vitest";
import { K6_PASS_THROUGH, k6Env } from "../src/node/k6-env.ts";

describe("minor 586 — k6 gets an allow-listed environment", () => {
  it("passes PATH, HOME and TMPDIR from the shell, then the tool's own variables; nothing else", () => {
    expect([...K6_PASS_THROUGH]).toEqual(["PATH", "HOME", "TMPDIR"]);
    const env = k6Env(
      { PATH: "/bin", HOME: "/h", OWNER_DATABASE_URL: "postgres://owner", DATABASE_URL: "postgres://app", K6_FOO: "1", TMPDIR: undefined },
      { LOADTEST_TARGET: "local", K6_PROMETHEUS_RW_SERVER_URL: "http://x" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LOADTEST_TARGET: "local", K6_PROMETHEUS_RW_SERVER_URL: "http://x" });
  });

  it("the tool's own value wins over the shell's", () => {
    expect(k6Env({ PATH: "/bin" }, { PATH: "/tool" })).toEqual({ PATH: "/tool" });
  });
});
