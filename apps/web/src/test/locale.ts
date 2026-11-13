import { afterAll, beforeAll } from "vitest";

import { appLocale, setLocaleForTests } from "../ui/dateText";

/**
 * Spec 17.13 AC6: pin the app's date locale, beside `pinTimeZone` (`./timeZone.ts`). `setup.ts`
 * applies en-US to every test file, so the suite doesn't depend on the machine running it.
 */
export function applyLocale(locale: string): void {
  setLocaleForTests(locale);
  if (appLocale() !== locale) throw new Error(`locale not applied: ${locale}`);
}

export function withLocale<T>(locale: string, run: () => T): T {
  const previous = appLocale();
  applyLocale(locale);
  try {
    return run();
  } finally {
    applyLocale(previous);
  }
}

export function pinLocale(locale: string): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = appLocale();
    applyLocale(locale);
  });
  afterAll(() => {
    if (previous !== undefined) applyLocale(previous);
  });
}
