import { afterAll, beforeAll } from "vitest";

/**
 * Spec 18.0 Phase B: pin the device zone for tests that build or format local times. The forks
 * pool honors `process.env.TZ`; if `Intl` does not report the zone the helpers throw, so a pool
 * change fails loudly instead of testing in the wrong zone.
 */
function apply(tz: string): void {
  process.env["TZ"] = tz;
  const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (actual !== tz) throw new Error(`time zone not applied: ${tz}`);
}

function restore(previous: string | undefined): void {
  if (previous === undefined) delete process.env["TZ"];
  else process.env["TZ"] = previous;
}

export function inTimeZone<T>(tz: string, run: () => T): T {
  const previous = process.env["TZ"];
  apply(tz);
  try {
    return run();
  } finally {
    restore(previous);
  }
}

export function pinTimeZone(tz: string): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env["TZ"];
    apply(tz);
  });
  afterAll(() => restore(previous));
}
