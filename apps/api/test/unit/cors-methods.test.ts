import { describe, it, expect } from "vitest";
import { CORS_METHODS, assertCorsAllowsMethod } from "../../src/plugins/cors-methods.js";
import { buildTestApp } from "../helpers/build-test-app.js";

describe("buildApp wires assertCorsAllowsMethod into the root onRoute hook", () => {
  it("a route registered with a non-CORS-allowed method fails assembly", async () => {
    const { app } = await buildTestApp();
    // `hide` exempts the route from the response-schema check, so only the CORS
    // check can reject it.
    expect(() =>
      app.route({
        method: "TRACE",
        url: "/__cors-wiring",
        schema: { hide: true },
        handler: async () => ({}),
      }),
    ).toThrow(/TRACE \/__cors-wiring.*CORS/);
  });
});

describe("assertCorsAllowsMethod — every route method is CORS-allowed (2026-10-11 PUT bug)", () => {
  it("accepts every method in CORS_METHODS", () => {
    for (const method of CORS_METHODS) {
      expect(() => assertCorsAllowsMethod({ method, url: "/v1/x" })).not.toThrow();
    }
  });

  it("includes PUT (routine edit, Spec 09)", () => {
    expect(CORS_METHODS).toContain("PUT");
  });

  it("skips HEAD — Fastify adds a HEAD route per GET and HEAD is never preflighted", () => {
    expect(() => assertCorsAllowsMethod({ method: "HEAD", url: "/v1/x" })).not.toThrow();
  });

  it("throws for a method missing from the list, naming the route and the method", () => {
    expect(() => assertCorsAllowsMethod({ method: "PROPFIND", url: "/v1/things/:id" })).toThrow(
      /PROPFIND \/v1\/things\/:id.*PROPFIND/,
    );
  });

  it("checks every entry of a method array", () => {
    expect(() => assertCorsAllowsMethod({ method: ["GET", "PROPFIND"], url: "/v1/x" })).toThrow(
      /PROPFIND/,
    );
    expect(() => assertCorsAllowsMethod({ method: ["GET", "HEAD"], url: "/v1/x" })).not.toThrow();
  });

  it("compares case-insensitively", () => {
    expect(() => assertCorsAllowsMethod({ method: "put", url: "/v1/x" })).not.toThrow();
    expect(() => assertCorsAllowsMethod({ method: "propfind", url: "/v1/x" })).toThrow();
  });
});
