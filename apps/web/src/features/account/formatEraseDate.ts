/**
 * Spec 12 §6.6 / AC21 — `purgeEligibleAt` as a long date in the profile's IANA zone. A host whose ICU
 * lacks the stored zone throws `RangeError`; retry in the device zone (the gap `ProfileScreen` tolerates).
 */
export function formatEraseDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  // Called during render: a malformed value (the client passes a schema-mismatched body through in
  // production) must show as-is rather than blank the post-lock screen.
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch (error) {
    if (error instanceof RangeError && timeZone) return formatEraseDate(iso);
    throw error;
  }
}
