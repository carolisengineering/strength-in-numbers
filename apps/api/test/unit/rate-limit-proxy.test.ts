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

describe("§6.6 — trustProxyTripwire: a forwarded request whose chain yields no client", () => {
  const warn = vi.fn();
  const req = (ip: string, socket: string, xff?: string) =>
    ({
      ip,
      socket: { remoteAddress: socket },
      headers: xff === undefined ? {} : { "x-forwarded-for": xff },
      log: { warn },
    }) as unknown as FastifyRequest;

  it("internal probes with no X-Forwarded-For never warn — even from loopback", () => {
    warn.mockClear();
    const trip = trustProxyTripwire();
    trip(req("127.0.0.1", "127.0.0.1"));
    trip(req("10.0.0.5", "10.0.0.5"));
    expect(warn).not.toHaveBeenCalled();
  });
  it("a forwarded request resolved to a real client never warns", () => {
    warn.mockClear();
    const trip = trustProxyTripwire();
    trip(req("73.8.137.104", "104.22.64.33", "73.8.137.104"));
    expect(warn).not.toHaveBeenCalled();
  });
  it("warns once when req.ip is still a known proxy address (the chain ran out)", () => {
    warn.mockClear();
    const trip = trustProxyTripwire();
    trip(req("104.22.64.33", "127.0.0.1", "104.22.64.33, 10.1.2.3"));
    trip(req("10.1.2.3", "127.0.0.1", "10.1.2.3"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ ip: "104.22.64.33", reason: "proxy-address" }, "trust_proxy_suspect");
  });
  it("warns once when the header was ignored (req.ip is an untrusted socket)", () => {
    warn.mockClear();
    const trip = trustProxyTripwire();
    trip(req("198.18.0.9", "198.18.0.9", "198.51.100.7"));
    expect(warn).toHaveBeenCalledWith({ ip: "198.18.0.9", reason: "forwarded-ignored" }, "trust_proxy_suspect");
  });
});

describe("AC11 / D12 — req.ip is the client Cloudflare saw; a forged X-Forwarded-For can't choose it", () => {
  async function ipFor(remoteAddress: string, xff: string): Promise<string> {
    const { app } = await buildTestApp();
    app.get("/__ip", { schema: { hide: true } }, async (request) => ({ ip: request.ip }));
    const res = await app.inject({ method: "GET", url: "/__ip", remoteAddress, headers: { "x-forwarded-for": xff } });
    return res.json().ip;
  }
  it("staging evidence, chain A: the socket is the Cloudflare edge", async () => {
    expect(await ipFor("104.22.64.33", "203.0.113.9, 73.8.137.104")).toBe("73.8.137.104");
  });
  it("staging evidence, chain B: loopback sidecar → Render proxy → Cloudflare edge", async () => {
    expect(await ipFor("127.0.0.1", "203.0.113.9, 73.8.137.104, 104.22.64.33, 10.1.2.3")).toBe("73.8.137.104");
  });
  it("private Render proxy + one Cloudflare hop; forged entries further left are never reached", async () => {
    expect(await ipFor("10.0.0.5", "6.6.6.6, 198.51.100.7, 172.70.1.1")).toBe("198.51.100.7");
  });
  it("a forged Cloudflare address left of the real client is still never reached", async () => {
    expect(await ipFor("104.22.64.33", "104.16.0.1, 73.8.137.104")).toBe("73.8.137.104");
  });
  it("an IPv6 Cloudflare edge socket is trusted", async () => {
    expect(await ipFor("2606:4700::6810:1", "73.8.137.104")).toBe("73.8.137.104");
  });
  it("a public, non-Cloudflare peer is the client itself; its X-Forwarded-For is ignored", async () => {
    expect(await ipFor("203.0.113.50", "198.51.100.7, 172.70.1.1")).toBe("203.0.113.50");
  });
});

describe("D12 — trustRenderProxy trusts proxy addresses, not hop counts", () => {
  it.each([
    ["10.0.0.5", true],
    ["127.0.0.1", true],
    ["104.22.64.33", true], // Cloudflare 104.16.0.0/13
    ["172.70.1.1", true], // Cloudflare 172.64.0.0/13
    ["2606:4700::6810:1", true], // Cloudflare 2606:4700::/32
    ["73.8.137.104", false],
    ["203.0.113.50", false],
  ])("%s → %s, whatever its position in the chain", (address, expected) => {
    expect(trustRenderProxy(address)).toBe(expected);
  });
});
