/**
 * The one place `local_date` is derived (Spec 05.0 §5, §6.3). Both functions
 * are pure — no `Date.now()`, no I/O — so the calling handler is the only code
 * that decides *when* they run, and a test can pin any instant.
 */

/**
 * Shifts `instantIso` by `offsetMinutes` (minutes EAST of UTC — the sign
 * convention of the ISO 8601 offset itself, and the negation of
 * `Date.prototype.getTimezoneOffset()`) and returns the resulting calendar
 * date as `"YYYY-MM-DD"`. Plain arithmetic, no `Intl` — the offset is a known
 * integer, not something that needs zone-database lookup here.
 */
export function localDateFor(instantIso: string, offsetMinutes: number): string {
  const instantMs = Date.parse(instantIso);
  const shiftedMs = instantMs + offsetMinutes * 60_000;
  const d = new Date(shiftedMs);
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The IANA zone's UTC offset, in minutes EAST of UTC, at the given instant —
 * so a DST transition is honored (Spec 05.0 §6.3). Uses `Intl.DateTimeFormat`
 * with `timeZoneName: "longOffset"`, which renders `GMT±HH:MM` (bare `GMT`
 * for UTC, parsed as 0). ECMA-402, not a Node API, so this stays inside the
 * `core:purity` boundary.
 */
export function offsetMinutesForZone(instantIso: string, ianaTimeZone: string): number {
  const date = new Date(instantIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  if (tzPart === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzPart);
  if (!match) {
    throw new Error(
      `offsetMinutesForZone: unparseable offset "${tzPart}" for zone "${ianaTimeZone}"`,
    );
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}
