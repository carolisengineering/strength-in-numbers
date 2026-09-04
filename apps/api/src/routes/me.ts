import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MeSchema, UpdateMeSchema, type Me } from "@sin/core";
import type {
  ProfilePatch,
  UserRecord,
  UserRepository,
} from "../repositories/user.js";

/**
 * `GET /v1/me` and `PATCH /v1/me` (Spec 01 §5, migrated onto the contract
 * pipeline in Spec 03.0 §6.4).
 *
 * Validation and handler types both come from the `@sin/core` Zod DTOs:
 * `MeSchema` is the response schema for both verbs, `UpdateMeSchema` the `PATCH`
 * body. `UpdateMeSchema` is `.strict()` and now carries the `timezone` IANA
 * `.refine()` (Spec 03.0 P6), so unknown-key / bad-enum / empty-string /
 * invalid-zone rejections all surface as `422 validation-error` through the Zod
 * error path — no hand-written body schema or `isValidTimeZone` helper here any
 * more.
 *
 * Provisioning happens in the auth plugin, so by the time a handler runs
 * `request.user` is a live row. GET echoes `isNewUser`; PATCH does not.
 */

export interface MeRouteDeps {
  userRepository: UserRepository;
}

/**
 * DB row → wire DTO. `id` is a plain string on the row and a branded `UserId` on
 * `MeSchema`; the value is the same UUID, so the brand is asserted here rather
 * than re-parsed.
 */
function view(u: UserRecord): Me {
  return {
    id: u.id as Me["id"],
    email: u.email,
    displayName: u.displayName,
    unitPreference: u.unitPreference,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
  };
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/me",
    { schema: { response: { 200: MeSchema } } },
    async (request) => ({
      ...view(request.user!),
      isNewUser: request.isNewUser === true,
    }),
  );

  r.patch(
    "/me",
    { schema: { body: UpdateMeSchema, response: { 200: MeSchema } } },
    async (request) => {
      const body = request.body;
      const patch: ProfilePatch = {};

      if ("displayName" in body) {
        patch.displayName = body.displayName ?? null;
      }
      if ("unitPreference" in body) {
        patch.unitPreference = body.unitPreference;
      }
      if ("timezone" in body) {
        patch.timezone = body.timezone;
      }

      const updated = await deps.userRepository.updateProfile(
        request.user!.id,
        patch,
      );
      return view(updated);
    },
  );
}
