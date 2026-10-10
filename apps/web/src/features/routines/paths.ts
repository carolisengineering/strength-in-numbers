export const WORKOUTS_PATH = "/app/workouts";
export const NEW_ROUTINE_PATH = "/app/workouts/routines/new";
export const routinePath = (id: string): string => `/app/workouts/routines/${encodeURIComponent(id)}`;
/**
 * Router state on every link into the editor from a screen one Back away (the preview, the Start
 * screen): leaving the editor then goes Back instead of pushing, so history never holds the editor or a
 * duplicate preview behind the screen the lifter returns to.
 */
export const EDITOR_FROM_BACK = { back: true } as const;

export const cameFromBack = (state: unknown): boolean =>
  typeof state === "object" && state !== null && (state as Record<string, unknown>)["back"] === true;

export const routineEditPath = (id: string): string => `${routinePath(id)}/edit`;
