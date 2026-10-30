/**
 * Spec 20.2 AC2: the day a link was last synced, "Sat 24 Oct", in the device zone (it is an instant, unlike the
 * summary's stored `localDate`, so `features/workouts/format.ts` doesn't fit). `en-GB` so it reads like the summary's
 * date. `timeZone` is for tests only.
 */
export function sentDay(iso: string, opts: { timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }).format(new Date(iso));
}
