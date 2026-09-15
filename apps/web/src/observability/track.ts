/**
 * Product-analytics seam (Spec 04.0 §9, shipped by Spec 04.1 §9). A no-op until
 * Spec 13 swaps the body for PostHog. `event` is a fixed snake_case name
 * (`profile_saved`); `props` carries only non-identifying scalars — never a
 * token, `email`, `displayName`, or free text the user typed (DESIGN §8.1).
 *
 * React-free and DOM-free, like `reportError`.
 */
export type TrackProps = Readonly<Record<string, string | number | boolean>>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function track(event: string, props?: TrackProps): void {
  // Intentionally empty (Spec 13).
}
