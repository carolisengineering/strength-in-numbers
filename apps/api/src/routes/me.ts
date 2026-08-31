import type { FastifyInstance } from "fastify";
import { ValidationError } from "../errors/app-error.js";
import type {
  ProfilePatch,
  UserRecord,
  UserRepository,
} from "../repositories/user.js";

/**
 * `GET /v1/me` and `PATCH /v1/me` (Spec 01 §5).
 *
 * Provisioning happens in the auth plugin, so by the time a handler runs
 * `request.user` is a live row. GET echoes `isNewUser`; PATCH does not.
 */

export interface MeRouteDeps {
  userRepository: UserRepository;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface MeView {
  id: string;
  email: string;
  displayName: string | null;
  unitPreference: "kg" | "lb";
  timezone: string;
  createdAt: string;
}

function view(u: UserRecord): MeView {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    unitPreference: u.unitPreference,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
  };
}

const patchBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    displayName: { type: ["string", "null"], maxLength: 80 },
    unitPreference: { type: "string", enum: ["kg", "lb"] },
    timezone: { type: "string", minLength: 1 },
  },
} as const;

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  app.get("/me", async (request) => ({
    ...view(request.user!),
    isNewUser: request.isNewUser === true,
  }));

  app.patch(
    "/me",
    { schema: { body: patchBodySchema } },
    async (request) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: ProfilePatch = {};

      if ("displayName" in body) {
        patch.displayName = body.displayName as string | null;
      }
      if ("unitPreference" in body) {
        patch.unitPreference = body.unitPreference as "kg" | "lb";
      }
      if ("timezone" in body) {
        const tz = body.timezone as string;
        if (!isValidTimeZone(tz)) {
          throw new ValidationError([
            { path: "timezone", message: "not a valid IANA time zone" },
          ]);
        }
        patch.timezone = tz;
      }

      const updated = await deps.userRepository.updateProfile(
        request.user!.id,
        patch,
      );
      return view(updated);
    },
  );
}
