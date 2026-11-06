import { describe, expect, it } from "vitest";
import { localTokens } from "../src/node/tokens-local.ts";
import { apiFor } from "../src/node/api.ts";

describe("local tokens from dev-idp", () => {
  it("Review Focus 2 — asks for tokens that outlive the run, one per account", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ access_token: `tok-${urls.length}`, token_type: "Bearer" }), { status: 200 });
    }) as unknown as typeof fetch;
    const tokens = await localTokens(["loadtest|001", "loadtest|002"], { idpUrl: "http://localhost:9999", expiresInS: 25200, fetchFn });
    expect(tokens).toEqual(["tok-1", "tok-2"]);
    expect(urls).toHaveLength(2);
    const u = new URL(urls[0]!);
    expect(u.pathname).toBe("/token");
    expect(u.searchParams.get("sub")).toBe("loadtest|001");
    expect(u.searchParams.get("email")).toBe("loadtest+001@example.test");
    // dev-idp passes this to jose's setExpirationTime, which needs a unit.
    expect(u.searchParams.get("expires_in")).toBe("25200s");
  });

  it("a failed token request throws without echoing a token", async () => {
    const fetchFn = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(localTokens(["loadtest|001"], { idpUrl: "http://localhost:9999", expiresInS: 60, fetchFn })).rejects.toThrow(
      /dev-idp \/token answered 500/,
    );
  });
});

describe("apiFor", () => {
  it("sends the bearer token and a fresh, well-formed X-Request-Id per request", async () => {
    const seen: Headers[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const api = apiFor("http://localhost:8080", "secret-token", fetchFn);
    expect(await api.get("/v1/me")).toEqual({ status: 200, body: { ok: true } });
    await api.del("/v1/workouts/x");
    expect(seen[0]!.get("authorization")).toBe("Bearer secret-token");
    const ids = seen.map((h) => h.get("x-request-id")!);
    expect(ids[0]).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
