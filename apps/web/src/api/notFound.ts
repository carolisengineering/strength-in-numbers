import { ApiError } from "./problem";

/** The server answered 404: the thing named is not there (minor 234). The one test every not-found swallow uses. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** A repeat of an already-applied delete answers 404: it already happened, so the screen treats it as success (minor 68). */
export async function ignoreNotFound(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
