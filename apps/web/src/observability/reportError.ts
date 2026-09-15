/**
 * Error-reporting seam (Spec 04.0 §9, shipped by Spec 04.1 §9). A no-op until
 * Spec 13 swaps the body for Sentry. Callers pass the error and a small bag of
 * **static** string tags (`{ boundary: "root" }`); never a token, `email`,
 * `displayName`, or anything else user-identifying (DESIGN §8.1).
 *
 * Kept React-free and DOM-free so the API client and a future React Native app
 * can call it unchanged.
 */
export type ErrorContext = Readonly<Record<string, string>>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function reportError(error: unknown, context?: ErrorContext): void {
  // Intentionally empty (Spec 13).
}
