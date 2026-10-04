import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { isPrivateAddress, trustProxyTripwire, trustRenderProxy } from "../../src/plugins/rate-limit.js";
import { buildTestApp } from "../helpers/build-test-app.js";

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

describe("§6.6 — trustProxyTripwire warns once on a private req.ip", () => {
  it("one warn trust_proxy_suspect, then silent; public addresses never warn", () => {
    const warn = vi.fn();
    const req = (ip: string) => ({ ip, log: { warn } }) as unknown as FastifyRequest;
    const trip = trustProxyTripwire();
    trip(req("203.0.113.9"));
    trip(req("10.0.0.5"));
    trip(req("10.0.0.6"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ ip: "10.0.0.5" }, "trust_proxy_suspect");
  });
  it("Final review — warns once when X-Forwarded-For was sent but ignored (req.ip is the socket)", () => {
    const warn = vi.fn();
    const req = (ip: string, socket: string, xff?: string) =>
      ({
        ip,
        socket: { remoteAddress: socket },
        headers: xff === undefined ? {} : { "x-forwarded-for": xff },
        log: { warn },
      }) as unknown as FastifyRequest;
    const trip = trustProxyTripwire();
    trip(req("198.51.100.7", "203.0.113.50")); // no header: a direct client, fine
    trip(req("198.51.100.7", "10.0.0.5", "198.51.100.7, 172.70.1.1")); // header honoured
    expect(warn).not.toHaveBeenCalled();
    trip(req("198.18.0.9", "198.18.0.9", "198.51.100.7, 172.70.1.1")); // header ignored
    trip(req("198.18.0.9", "198.18.0.9", "198.51.100.8, 172.70.1.1"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ ip: "198.18.0.9", forwardedIgnored: true }, "trust_proxy_suspect");
  });
});

describe("AC11 — req.ip is the address Cloudflare saw; a forged X-Forwarded-For can't choose it", () => {
  it("trusts exactly 2 hops", async () => {
    const { app } = await buildTestApp();
    app.get("/__ip", { schema: { hide: true } }, async (request) => ({ ip: request.ip }));
    const ipFor = async (xff: string) =>
      (
        await app.inject({
          method: "GET",
          url: "/__ip",
          remoteAddress: "10.0.0.5",
          headers: { "x-forwarded-for": xff },
        })
      ).json().ip;
    expect(await ipFor("198.51.100.7, 172.70.1.1")).toBe("198.51.100.7");
    expect(await ipFor("6.6.6.6, 198.51.100.7, 172.70.1.1")).toBe("198.51.100.7");
  });
  it("a public socket (not Render's proxy) is the client; its X-Forwarded-For is ignored", async () => {
    const { app } = await buildTestApp();
    app.get("/__ip", { schema: { hide: true } }, async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      remoteAddress: "203.0.113.50",
      headers: { "x-forwarded-for": "198.51.100.7, 172.70.1.1" },
    });
    expect(res.json().ip).toBe("203.0.113.50");
  });
});

describe("D12 — trustRenderProxy", () => {
  it("trusts a private socket and exactly one more hop", () => {
    expect(trustRenderProxy("10.0.0.5", 0)).toBe(true);
    expect(trustRenderProxy("203.0.113.50", 0)).toBe(false);
    expect(trustRenderProxy("172.70.1.1", 1)).toBe(true);
    expect(trustRenderProxy("198.51.100.7", 2)).toBe(false);
  });
});
