import { describe, expect, it } from "vitest";
import { K6_PASS_THROUGH, k6Env } from "../src/node/k6-env.ts";

describe("minor 586 — k6 gets an allow-listed environment", () => {
  it("passes PATH, HOME, TMPDIR and the proxy / CA variables from the shell, then the tool's own variables; nothing else", () => {
    expect([...K6_PASS_THROUGH]).toEqual([
      "PATH",
      "HOME",
      "TMPDIR",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "https_proxy",
      "http_proxy",
      "no_proxy",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ]);
    const env = k6Env(
      { PATH: "/bin", HOME: "/h", OWNER_DATABASE_URL: "postgres://owner", DATABASE_URL: "postgres://app", K6_FOO: "1", TMPDIR: undefined },
      { LOADTEST_TARGET: "local", K6_PROMETHEUS_RW_SERVER_URL: "http://x" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LOADTEST_TARGET: "local", K6_PROMETHEUS_RW_SERVER_URL: "http://x" });
  });

  it("minor 605 / Review Focus 5 — proxy and CA variables reach k6, lowercase too; unset ones and others don't", () => {
    const env = k6Env(
      {
        PATH: "/bin",
        HTTPS_PROXY: "http://proxy:3128",
        no_proxy: "localhost",
        SSL_CERT_FILE: "/ca.pem",
        HTTP_PROXY: undefined,
        ALL_PROXY: "socks5://x",
        OWNER_DATABASE_URL: "postgres://owner",
      },
      {},
    );
    expect(env).toEqual({ PATH: "/bin", HTTPS_PROXY: "http://proxy:3128", no_proxy: "localhost", SSL_CERT_FILE: "/ca.pem" });
  });

  it("the tool's own value wins over the shell's", () => {
    expect(k6Env({ PATH: "/bin" }, { PATH: "/tool" })).toEqual({ PATH: "/tool" });
  });
});
