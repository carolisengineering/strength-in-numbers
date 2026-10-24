import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { loadConfig, ConfigError } from "../../src/config.js";
import { CLOUD_RUN_XFF_HOPS, clientAddress, trustProxyTripwire } from "../../src/plugins/rate-limit.js";
import { TEST_ENV, buildTestApp, limitsWith } from "../helpers/build-test-app.js";

/** A request as `clientAddress` / the tripwire see it. */
function req(socket: string, headers: Record<string, string> = {}, warn = vi.fn()): FastifyRequest {
  return { ip: socket, socket: { remoteAddress: socket }, headers, log: { warn } } as unknown as FastifyRequest;
}
const cloudRun = () => loadConfig({ ...TEST_ENV, CLIENT_IP_SOURCE: "cloud-run" });

describe("15 AC25 — CLIENT_IP_SOURCE", () => {
  it("render and cloud-run are accepted; unset is render", () => {
    expect(loadConfig({ ...TEST_ENV, CLIENT_IP_SOURCE: "render" }).clientIpSource).toBe("render");
    expect(cloudRun().clientIpSource).toBe("cloud-run");
    expect(loadConfig({ ...TEST_ENV }).clientIpSource).toBe("render");
  });
  it("anything else fails boot naming the variable", () => {
    expect(() => loadConfig({ ...TEST_ENV, CLIENT_IP_SOURCE: "cloudrun" })).toThrowError(ConfigError);
    expect(() => loadConfig({ ...TEST_ENV, CLIENT_IP_SOURCE: "cloudrun" })).toThrowError(/CLIENT_IP_SOURCE/);
  });
});

describe("15 AC26 — clientAddress in cloud-run mode", () => {
  it("the hop count is the named constant 1 (an assumption until AC28 measures it)", () => expect(CLOUD_RUN_XFF_HOPS).toBe(1));
  const CASES: [socket: string, headers: Record<string, string>, expected: string, why: string][] = [
    ["169.254.1.1", { "x-forwarded-for": "203.0.113.5" }, "203.0.113.5", "the front end's appended entry"],
    ["169.254.1.1", { "x-forwarded-for": "1.2.3.4, 203.0.113.5" }, "203.0.113.5", "a forged left entry is ignored (Review Focus 1)"],
    ["169.254.1.1", { "x-forwarded-for": "1.2.3.4,203.0.113.5" }, "203.0.113.5", "no space after the comma"],
    ["169.254.1.1", { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "203.0.113.5" }, "203.0.113.5", "CF-Connecting-IP is never read"],
    ["169.254.1.1", { "cf-connecting-ip": "9.9.9.9" }, "169.254.1.1", "CF alone → the socket"],
    ["198.51.100.7", { "x-forwarded-for": "203.0.113.5", "cf-connecting-ip": "9.9.9.9" }, "198.51.100.7", "a public socket is the client"],
    ["169.254.1.1", { "x-forwarded-for": "" }, "169.254.1.1", "empty list → the socket"],
    ["169.254.1.1", { "x-forwarded-for": "1.2.3.4, " }, "169.254.1.1", "a trailing empty entry → the socket"],
    ["169.254.1.1", { "x-forwarded-for": "garbage" }, "169.254.1.1", "garbage → the socket"],
    ["169.254.1.1", { "x-forwarded-for": "2001:db8::1" }, "2001:db8::1", "an IPv6 entry"],
    ["::ffff:10.0.0.1", { "x-forwarded-for": "203.0.113.5" }, "203.0.113.5", "an IPv4-mapped private socket is private"],
    ["169.254.1.1", {}, "169.254.1.1", "a probe: no header → the socket"],
  ];
  it.each(CASES)("%s %j → %s (%s)", (socket, headers, expected) => expect(clientAddress(req(socket, headers), "cloud-run")).toBe(expected));
});

describe("15 AC25 — render mode unchanged", () => {
  it.each([
    ["10.1.2.3", { "cf-connecting-ip": "73.8.137.104", "x-forwarded-for": "203.0.113.5" }, "73.8.137.104"],
    ["169.254.1.1", { "x-forwarded-for": "203.0.113.5" }, "169.254.1.1"],
    ["198.51.100.7", { "cf-connecting-ip": "9.9.9.9" }, "198.51.100.7"],
  ])("%s %j → %s with the source omitted", (socket, headers, expected) => {
    expect(clientAddress(req(socket, headers))).toBe(expected);
    expect(clientAddress(req(socket, headers), "render")).toBe(expected);
  });
});

describe("15 AC27 — the tripwire in cloud-run mode", () => {
  it("fires once with no-xff for a private socket whose X-Forwarded-For is unusable", () => {
    const warn = vi.fn();
    const trip = trustProxyTripwire("cloud-run");
    trip(req("169.254.1.1", { "x-forwarded-for": "garbage" }, warn));
    trip(req("169.254.1.1", { "x-forwarded-for": "garbage" }, warn));
    expect(warn.mock.calls).toEqual([[{ socket: "169.254.1.1", reason: "no-xff" }, "trust_proxy_suspect"]]);
  });
  it("fires once with unknown-proxy for a public socket carrying X-Forwarded-For", () => {
    const warn = vi.fn();
    trustProxyTripwire("cloud-run")(req("198.51.100.7", { "x-forwarded-for": "203.0.113.5" }, warn));
    expect(warn.mock.calls).toEqual([[{ socket: "198.51.100.7", reason: "unknown-proxy" }, "trust_proxy_suspect"]]);
  });
  it("a probe (private socket, no header) never spends the warning; a later bad request still fires", () => {
    const warn = vi.fn();
    const trip = trustProxyTripwire("cloud-run");
    trip(req("169.254.1.1", {}, warn));
    trip(req("169.254.1.1", { "x-forwarded-for": "203.0.113.5" }, warn));
    expect(warn).not.toHaveBeenCalled();
    trip(req("169.254.1.1", { "x-forwarded-for": "1.2.3.4, " }, warn));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("15 AC26 — end to end in cloud-run mode", () => {
  it("the L1 limit keys on the right-most entry: a forged left entry can't buy a fresh bucket", async () => {
    const { app } = await buildTestApp({ config: cloudRun(), rateLimits: limitsWith({ ip: 1 }) });
    const call = (xff: string) =>
      app.inject({ method: "GET", url: "/v1/me", remoteAddress: "169.254.1.1", headers: { authorization: "Bearer t", "x-forwarded-for": xff } });
    expect((await call("6.6.6.6, 203.0.113.5")).statusCode).not.toBe(429);
    expect((await call("7.7.7.7, 203.0.113.5")).statusCode).toBe(429);
  });
  it("request completed logs the resolved client_ip, never the forged entries", async () => {
    const lines: Record<string, unknown>[] = [];
    const { pino } = await import("pino");
    const logger = pino({ level: "info" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const { app } = await buildTestApp({ config: cloudRun(), logger });
    await app.inject({
      method: "GET",
      url: "/healthz",
      remoteAddress: "169.254.1.1",
      headers: { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6, 203.0.113.5" },
    });
    expect(lines.find((l) => l.msg === "request completed")).toMatchObject({ client_ip: "203.0.113.5" });
  });
});
