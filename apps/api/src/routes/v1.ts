import type { FastifyInstance } from "fastify";
import type { UserRepository } from "../repositories/user.js";
import { registerAuthcheckRoute } from "./authcheck.js";
import { registerMeRoutes } from "./me.js";

export interface V1RouteDeps {
  userRepository: UserRepository;
}

export function registerV1Routes(
  app: FastifyInstance,
  deps: V1RouteDeps,
): void {
  registerAuthcheckRoute(app);
  registerMeRoutes(app, { userRepository: deps.userRepository });
}
