import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, isLostSession } from "./client";
import { ApiError } from "./problem";

const LOST = ["login_required", "invalid_grant", "missing_refresh_token", "consent_required", "interaction_required"];

const auth0Error = (code: string) => Object.assign(new Error("x"), { error: code });

function makeClient(getToken: () => Promise<string>) {
  const onAuthLost = vi.fn();
  return { onAuthLost, client: createApiClient({ baseUrl: "https://api.test", appEnv: "local", getToken, onAuthLost }) };
}

afterEach(() => vi.restoreAllMocks());

describe("06.2 AC9 — losing the network is not losing the session", () => {
  it.each(LOST)("an Auth0 error with error=%s is a lost session", (code) => {
    expect(isLostSession(auth0Error(code), true)).toBe(true);
  });

  it("a plain Error whose message is a lost-session code is a lost session (SDK message form)", () => {
    expect(isLostSession(new Error("missing_refresh_token"), true)).toBe(true);
  });

  it.each([
    ["a fetch TypeError", new TypeError("Failed to fetch")],
    ["an Auth0 timeout (the token request never answered)", auth0Error("timeout")],
  ])("%s is not a lost session: it is the network", (_label, cause) => {
    expect(isLostSession(cause, true)).toBe(false);
  });

  // Owner decision (code review #4, option b): online, any other token failure is a real auth problem.
  it.each([
    ["an unlisted Auth0 code (mfa_required)", auth0Error("mfa_required")],
    ["a blocked user (access_denied)", auth0Error("access_denied")],
    ["an unknown Error", new Error("boom")],
    ["a non-Error value", "nope"],
  ])("online, %s is a lost session", (_label, cause) => {
    expect(isLostSession(cause, true)).toBe(true);
  });

  it("nothing is a lost session while the browser is offline", () => {
    expect(isLostSession(auth0Error("invalid_grant"), false)).toBe(false);
  });

  it("a network-caused token failure throws a network ApiError and does not call onAuthLost", async () => {
    const { client, onAuthLost } = makeClient(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = (await client.get("/v1/me").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetworkError).toBe(true);
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it("offline, even invalid_grant does not log out", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { client, onAuthLost } = makeClient(() => Promise.reject(auth0Error("invalid_grant")));
    const error = (await client.get("/v1/me").catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it("a genuine lost session still calls onAuthLost once", async () => {
    const { client, onAuthLost } = makeClient(() => Promise.reject(auth0Error("login_required")));
    await client.get("/v1/me").catch(() => undefined);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });
});
