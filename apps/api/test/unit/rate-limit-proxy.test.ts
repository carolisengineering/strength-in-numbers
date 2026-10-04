import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { clientAddress, isPrivateAddress, trustProxyTripwire } from "../../src/plugins/rate-limit.js";
import { buildTestApp, limitsWith } from "../helpers/build-test-app.js";

describe("§6.6 — isPrivateAddress", () => {
  it.each([
    ["10.1.2.3", true],
    ["127.0.0.1", true],
    ["192.168.0.4", true],
    ["172.16.0.1", true],
    ["172.31.255.1", true],
    ["::1", true],
    ["fd12:3456::1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:a00:5", true], // hex-form IPv4-mapped 10.0.0.5
    ["::ffff:cb00:7109", false], // hex-form IPv4-mapped 203.0.113.9
    ["febf::1", true], // inside fe80::/10, not the literal fe80: prefix
    ["fec0::1", false],
    ["100.64.1.2", true], // CGNAT / shared address space (RFC 6598)
    ["100.127.255.1", true],
    ["100.128.0.1", false],
    ["172.32.0.1", false],
    ["203.0.113.9", false],
    ["2001:db8::1", false],
    ["::ffff:203.0.113.9", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

/** A request as `clientAddress` / the tripwire see it. */
function req(socket: string, headers: Record<string, string> = {}, warn = vi.fn()): FastifyRequest {
  return { ip: socket, socket: { remoteAddress: socket }, headers, log: { warn } } as unknown as FastifyRequest;
}

describe("AC11 / D12 — clientAddress: CF-Connecting-IP behind a known proxy, else the socket", () => {
  const CASES: [socket: string, headers: Record<string, string>, expected: string, why: string][] = [
    // [socket, headers, expected, why]
    ["127.0.0.1", { "cf-connecting-ip": "73.8.137.104" }, "73.8.137.104", "staging chain: loopback sidecar"],
    ["10.1.2.3", { "cf-connecting-ip": "73.8.137.104" }, "73.8.137.104", "private Render proxy"],
    ["104.22.64.33", { "cf-connecting-ip": "73.8.137.104" }, "73.8.137.104", "socket is the Cloudflare edge"],
    ["2606:4700::6810:1", { "cf-connecting-ip": "2001:db8::42" }, "2001:db8::42", "IPv6 edge and client"],
    ["203.0.113.50", { "cf-connecting-ip": "6.6.6.6" }, "203.0.113.50", "a public non-Cloudflare peer can't choose its key"],
    ["127.0.0.1", {}, "127.0.0.1", "internal probe: no header → the socket"],
    ["10.1.2.3", { "cf-connecting-ip": "not-an-ip" }, "10.1.2.3", "garbage header → the socket"],
  ];
  it.each(CASES)("%s %j → %s (%s)", (socket, headers, expected) => {
    expect(clientAddress(req(socket, headers))).toBe(expected);
  });

  it("code review #1: a WARP / Worker client's forged X-Forwarded-For is never used", () => {
    // Chain the reviews described: forged entry, the client's own Cloudflare
    // egress (WARP 104.28.x), the edge, Render — Cloudflare sets CF-Connecting-IP
    // to the egress address it actually saw.
    const r = req("10.1.2.3", {
      "x-forwarded-for": "6.6.6.6, 104.28.1.2, 104.22.64.33",
      "cf-connecting-ip": "104.28.1.2",
    });
    expect(clientAddress(r)).toBe("104.28.1.2");
  });

  it("the L1 limit keys on it end to end: a forged X-Forwarded-For can't buy a fresh bucket", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 1 }) });
    const call = (xff: string) =>
      app.inject({
        method: "GET",
        url: "/v1/me",
        remoteAddress: "10.1.2.3",
        headers: { authorization: "Bearer t", "cf-connecting-ip": "104.28.1.2", "x-forwarded-for": xff },
      });
    expect((await call("6.6.6.6")).statusCode).not.toBe(429);
    expect((await call("7.7.7.7")).statusCode).toBe(429);
  });
});

describe("§11 / runbook D4.d — every request logs its resolved client_ip, health checks included", () => {
  it("the 'request completed' line of a /healthz call carries client_ip from CF-Connecting-IP", async () => {
    const lines: Record<string, unknown>[] = [];
    const { pino } = await import("pino");
    const logger = pino({ level: "info" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const { app } = await buildTestApp({ logger });
    await app.inject({
      method: "GET",
      url: "/healthz",
      remoteAddress: "127.0.0.1",
      headers: { "cf-connecting-ip": "73.8.137.104", "x-forwarded-for": "203.0.113.9" },
    });
    const completed = lines.find((l) => l.msg === "request completed");
    expect(completed).toMatchObject({ client_ip: "73.8.137.104" });
  });
});

describe("§6.6 — trustProxyTripwire: the Cloudflare assumption broke", () => {
  it("never warns for requests through a known proxy that carry CF-Connecting-IP, or for header-less probes", () => {
    const warn = vi.fn();
    const trip = trustProxyTripwire();
    trip(req("127.0.0.1", { "cf-connecting-ip": "73.8.137.104", "x-forwarded-for": "73.8.137.104" }, warn));
    trip(req("127.0.0.1", {}, warn));
    trip(req("104.28.1.2", {}, warn)); // a WARP client hitting the origin directly with no header
    expect(warn).not.toHaveBeenCalled();
  });
  it("warns once when a forwarded request through a known proxy has no usable CF-Connecting-IP", () => {
    const warn = vi.fn();
    const trip = trustProxyTripwire();
    trip(req("10.1.2.3", { "x-forwarded-for": "73.8.137.104" }, warn));
    trip(req("10.1.2.3", { "x-forwarded-for": "73.8.137.105" }, warn));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ socket: "10.1.2.3", reason: "no-cf-connecting-ip" }, "trust_proxy_suspect");
  });
  it("warns once when a forwarded request arrives from an unknown public proxy", () => {
    const warn = vi.fn();
    const trip = trustProxyTripwire();
    trip(req("198.18.0.9", { "x-forwarded-for": "73.8.137.104" }, warn));
    expect(warn).toHaveBeenCalledWith({ socket: "198.18.0.9", reason: "unknown-proxy" }, "trust_proxy_suspect");
  });
});

describe("D12 — Fastify no longer trusts X-Forwarded-For", () => {
  it("req.ip is the socket even when a forwarding header is sent", async () => {
    const { app } = await buildTestApp();
    app.get("/__ip", { schema: { hide: true } }, async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      remoteAddress: "10.1.2.3",
      headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.7" },
    });
    expect(res.json().ip).toBe("10.1.2.3");
  });
});
