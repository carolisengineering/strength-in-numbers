/**
 * The IANA time-zone list for the Profile `<select>` (Spec 04.1 §5, Q23).
 * `Intl.supportedValuesOf` is ECMA-402 (every current browser); where it is
 * missing the caller falls back to a text input. Presentation only — the
 * server remains the validator (`UpdateMeSchema` → `422`).
 */
export function listTimeZones(): readonly string[] | undefined {
  if (typeof Intl.supportedValuesOf !== "function") return undefined;
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return undefined;
  }
}
