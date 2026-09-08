import type { FastifyInstance } from "fastify";
import type { UserRepository } from "../repositories/user.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import { registerAuthcheckRoute } from "./authcheck.js";
import { registerMeRoutes } from "./me.js";
import { registerExerciseRoutes } from "./exercises.js";

export interface V1RouteDeps {
  userRepository: UserRepository;
  exerciseRepository: ExerciseRepository;
}

export function registerV1Routes(
  app: FastifyInstance,
  deps: V1RouteDeps,
): void {
  registerAuthcheckRoute(app);
  registerMeRoutes(app, { userRepository: deps.userRepository });
  registerExerciseRoutes(app, { exerciseRepository: deps.exerciseRepository });
}
