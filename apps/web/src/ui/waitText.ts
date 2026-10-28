/** How long to wait after a `429`, from its Retry-After: "Try again in 12 seconds." / "Try again in a minute." */
export function waitText(retryAfterMs: number | null | undefined): string {
  if (retryAfterMs == null) return "Try again in a minute.";
  const n = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Try again in ${n} ${n === 1 ? "second" : "seconds"}.`;
}
