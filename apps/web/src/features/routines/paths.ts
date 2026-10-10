// apps/web/src/features/routines/paths.ts
export const WORKOUTS_PATH = "/app/workouts";
export const NEW_ROUTINE_PATH = "/app/workouts/routines/new";
export const routinePath = (id: string): string => `/app/workouts/routines/${encodeURIComponent(id)}`;
export const routineEditPath = (id: string): string => `${routinePath(id)}/edit`;
