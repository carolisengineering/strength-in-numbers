import { uuidv7 } from "uuidv7";
import type {
  ProfilePatch,
  ProvisionInput,
  ProvisionResult,
  UserRecord,
  UserRepository,
} from "../../src/repositories/user.js";
import type { AuthContext, TokenVerifier } from "../../src/auth/verify.js";

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const now = new Date("2026-08-30T12:00:00.000Z");
  return {
    id: uuidv7(),
    authSub: "auth0|user-123",
    email: "a@b.com",
    emailVerified: false,
    displayName: null,
    unitPreference: "kg",
    timezone: "UTC",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/** In-memory UserRepository for unit tests. */
export class FakeUserRepository implements UserRepository {
  private readonly bySub = new Map<string, UserRecord>();
  provisionCalls = 0;
  syncEmailCalls = 0;

  constructor(seed: UserRecord[] = []) {
    for (const u of seed) this.bySub.set(u.authSub, u);
  }

  seed(u: UserRecord): void {
    this.bySub.set(u.authSub, u);
  }

  private byId(id: string): UserRecord {
    const u = [...this.bySub.values()].find((x) => x.id === id);
    if (!u) throw new Error(`FakeUserRepository: no user ${id}`);
    return u;
  }

  async findByAuthSub(authSub: string): Promise<UserRecord | null> {
    return this.bySub.get(authSub) ?? null;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    this.provisionCalls += 1;
    const existing = this.bySub.get(input.authSub);
    if (existing) return { user: existing, isNewUser: false };
    const user = makeUser({
      authSub: input.authSub,
      email: input.email,
      emailVerified: input.emailVerified,
    });
    this.bySub.set(user.authSub, user);
    return { user, isNewUser: true };
  }

  async syncEmail(
    id: string,
    email: string,
    emailVerified: boolean,
  ): Promise<UserRecord> {
    this.syncEmailCalls += 1;
    const u = this.byId(id);
    const updated: UserRecord = {
      ...u,
      email,
      emailVerified,
      updatedAt: new Date(u.updatedAt.getTime() + 1000),
    };
    this.bySub.set(updated.authSub, updated);
    return updated;
  }

  async updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord> {
    const u = this.byId(id);
    const updated: UserRecord = {
      ...u,
      ...(patch.displayName !== undefined
        ? { displayName: patch.displayName }
        : {}),
      ...(patch.unitPreference !== undefined
        ? { unitPreference: patch.unitPreference }
        : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      updatedAt: new Date(u.updatedAt.getTime() + 1000),
    };
    this.bySub.set(updated.authSub, updated);
    return updated;
  }
}

export function fakeVerifier(
  handler: (token: string) => AuthContext | Promise<AuthContext>,
): TokenVerifier {
  return { verify: async (token: string) => handler(token) };
}

export function authContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    authSub: "auth0|user-123",
    email: "a@b.com",
    emailVerified: true,
    claims: {
      sub: "auth0|user-123",
      aud: "https://api.strengthinnumbers.app",
      exp: 9_999_999_999,
    },
    ...overrides,
  };
}
