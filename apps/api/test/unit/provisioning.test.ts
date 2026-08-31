import { describe, it, expect } from "vitest";
import { resolveUser } from "../../src/auth/provisioning.js";
import {
  AccountDeletedError,
  InvalidTokenError,
} from "../../src/errors/app-error.js";
import { FakeUserRepository, authContext, makeUser } from "../helpers/fakes.js";

describe("resolveUser (Spec 01 §6.2)", () => {
  it("provisions a new sub and reports isNewUser once", async () => {
    const repo = new FakeUserRepository();
    const auth = authContext({ authSub: "auth0|new", email: "n@b.com" });

    const first = await resolveUser(repo, auth);
    expect(first.isNewUser).toBe(true);
    expect(first.user.email).toBe("n@b.com");

    const second = await resolveUser(repo, auth);
    expect(second.isNewUser).toBe(false);
    // Second call finds the row in findByAuthSub and never reaches provision().
    expect(repo.provisionCalls).toBe(1);
  });

  it("refuses to provision when the token has no email claim", async () => {
    const repo = new FakeUserRepository();
    await expect(
      resolveUser(
        repo,
        authContext({
          authSub: "clients|m2m",
          email: undefined,
          emailVerified: undefined,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    expect(repo.provisionCalls).toBe(0);
  });

  it("throws AccountDeletedError for a soft-deleted row", async () => {
    const repo = new FakeUserRepository([
      makeUser({ authSub: "auth0|d", deletedAt: new Date() }),
    ]);
    await expect(
      resolveUser(repo, authContext({ authSub: "auth0|d" })),
    ).rejects.toBeInstanceOf(AccountDeletedError);
  });

  it("re-syncs when the token email differs from the stored row", async () => {
    const repo = new FakeUserRepository([
      makeUser({ authSub: "auth0|s", email: "old@b.com", emailVerified: false }),
    ]);
    const { user } = await resolveUser(
      repo,
      authContext({ authSub: "auth0|s", email: "new@b.com", emailVerified: true }),
    );
    expect(user.email).toBe("new@b.com");
    expect(user.emailVerified).toBe(true);
    expect(repo.syncEmailCalls).toBe(1);
  });

  it("does not re-sync on the common path (values already match)", async () => {
    const repo = new FakeUserRepository([
      makeUser({ authSub: "auth0|s", email: "a@b.com", emailVerified: true }),
    ]);
    await resolveUser(
      repo,
      authContext({ authSub: "auth0|s", email: "a@b.com", emailVerified: true }),
    );
    expect(repo.syncEmailCalls).toBe(0);
  });

  it("keeps stored email_verified when the token omits the claim", async () => {
    const repo = new FakeUserRepository([
      makeUser({ authSub: "auth0|s", email: "a@b.com", emailVerified: true }),
    ]);
    await resolveUser(
      repo,
      authContext({ authSub: "auth0|s", email: "a@b.com", emailVerified: undefined }),
    );
    expect(repo.syncEmailCalls).toBe(0);
  });
});
