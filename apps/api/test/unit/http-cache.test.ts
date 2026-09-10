import { describe, expect, it } from "vitest";
import Fastify, { type FastifyReply } from "fastify";
import { addVary, ifNoneMatchHits, strongEtag } from "../../src/routes/http-cache.js";

/** Spec 03.1 §6.1 step 4 / AC7 — the conditional-request helpers in isolation. */
describe("AC7 — http-cache helpers", () => {
  describe("strongEtag", () => {
    it('is a quoted 32-hex strong validator, namespaced by the first part', () => {
      const a = strongEtag("full", "[]");
      expect(a).toMatch(/^"[0-9a-f]{32}"$/);
      expect(strongEtag("full", "[]")).toBe(a);
      expect(strongEtag("2026-01-01T00:00:00.000Z", "[]")).not.toBe(a);
      expect(strongEtag("muscleGroups", "[]")).not.toBe(a);
    });
  });

  describe("ifNoneMatchHits — RFC 9110 §13.1.2 weak comparison", () => {
    const etag = strongEtag("full", "[]");

    it("matches the exact strong tag and a comma list containing it", () => {
      expect(ifNoneMatchHits(etag, etag)).toBe(true);
      expect(ifNoneMatchHits(`"other", ${etag}`, etag)).toBe(true);
      expect(ifNoneMatchHits(["\"other\"", etag], etag)).toBe(true);
    });

    it("matches a proxy-weakened W/ form of our tag (compressing edge)", () => {
      expect(ifNoneMatchHits(`W/${etag}`, etag)).toBe(true);
      expect(ifNoneMatchHits(`"x", W/${etag}`, etag)).toBe(true);
    });

    it("treats * as a match, and misses on absent / different tags", () => {
      expect(ifNoneMatchHits("*", etag)).toBe(true);
      expect(ifNoneMatchHits(undefined, etag)).toBe(false);
      expect(ifNoneMatchHits('"nope"', etag)).toBe(false);
      expect(ifNoneMatchHits(etag.slice(1, -1), etag)).toBe(false); // unquoted ≠
    });
  });

  describe("addVary", () => {
    async function varyAfter(setup: (reply: FastifyReply) => void) {
      const app = Fastify();
      app.get("/", async (_req, reply) => {
        setup(reply);
        return "ok";
      });
      const res = await app.inject({ method: "GET", url: "/" });
      await app.close();
      return res.headers.vary;
    }

    it("sets the header when absent", async () => {
      expect(await varyAfter((r) => addVary(r, "Authorization"))).toBe("Authorization");
    });

    it("appends to an existing value instead of replacing it", async () => {
      expect(
        await varyAfter((r) => {
          r.header("vary", "Origin");
          addVary(r, "Authorization");
        }),
      ).toBe("Origin, Authorization");
    });

    it("is idempotent and case-insensitive", async () => {
      expect(
        await varyAfter((r) => {
          r.header("vary", "authorization");
          addVary(r, "Authorization");
          addVary(r, "Authorization");
        }),
      ).toBe("authorization");
    });
  });
});
