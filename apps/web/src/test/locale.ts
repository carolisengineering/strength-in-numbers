import { afterAll, beforeAll } from "vitest";

import { appLocale, setLocaleForTests } from "../ui/dateText";

/**
 * Spec 17.13 AC6: pin the app's date locale, beside `pinTimeZone` (`./timeZone.ts`). `setup.ts`
 * applies en-US to every test file, so the suite doesn't depend on the machine running it.
 */
export function applyLocale(locale: string): void {
  setLocaleForTests(locale);
}

/**
 * Runs `run` under `locale` and restores the previous one when it returns. Synchronous only: the locale would be back
 * before an async callback's awaits resolved, so a returned promise throws. Use `pinLocale` in a `describe` instead.
 */
export function withLocale<T>(locale: string, run: () => T): T {
  const previous = appLocale();
  applyLocale(locale);
  try {
    const result = run();
    if (result instanceof Promise) throw new Error("withLocale is synchronous; use pinLocale for async tests");
    return result;
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
