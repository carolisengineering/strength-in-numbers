import type { FastifyInstance } from "fastify";
import type { UserRepository } from "../repositories/user.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import type { WorkoutRepository } from "../repositories/workout.js";
import { registerAuthcheckRoute } from "./authcheck.js";
import { registerMeRoutes } from "./me.js";
import { registerExerciseRoutes } from "./exercises.js";
import { registerReferenceRoutes } from "./reference.js";
import { registerWorkoutRoutes } from "./workouts.js";

export interface V1RouteDeps {
  userRepository: UserRepository;
  exerciseRepository: ExerciseRepository;
  workoutRepository: WorkoutRepository;
}

export function registerV1Routes(
  app: FastifyInstance,
  deps: V1RouteDeps,
): void {
  registerAuthcheckRoute(app);
  registerMeRoutes(app, { userRepository: deps.userRepository });
  registerExerciseRoutes(app, { exerciseRepository: deps.exerciseRepository });
  registerReferenceRoutes(app, { exerciseRepository: deps.exerciseRepository });
  registerWorkoutRoutes(app, { workoutRepository: deps.workoutRepository });
}
