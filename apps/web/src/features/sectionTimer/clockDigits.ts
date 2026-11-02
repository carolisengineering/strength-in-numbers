/**
 * Spec 10.7 AC1–AC2: a clock field holds digits that fill from the right (`341` is 3:41), at most five
 * (`123:45`). Pure; the field's display and every bound message use these, never a second formatter.
 */
export const CLOCK_DIGITS_MAX = 5;

/** The field's text: minutes unpadded, seconds padded (`0:03`, `3:41`, `123:45`); `""` for no digits. */
export function digitsToText(d: string): string {
  if (d === "") return "";
  const all = d.padStart(3, "0");
  return `${Number.parseInt(all.slice(0, -2), 10)}:${all.slice(-2)}`;
}

/** The seconds the digits mean, or `null` when empty or when the last two digits are 60 or more. */
export function digitsToSeconds(d: string): number | null {
  if (d === "") return null;
  const secs = Number.parseInt(d.slice(-2), 10);
  if (secs >= 60) return null;
  const minutes = d.length > 2 ? Number.parseInt(d.slice(0, -2), 10) : 0;
  return minutes * 60 + secs;
}

/** The digits for a number of seconds, with no leading zero (`221` → `"341"`); `""` for 0. */
export function secondsToDigits(s: number): string {
  if (s <= 0) return "";
  const minutes = Math.floor(s / 60);
  const secs = s % 60;
  return minutes === 0 ? String(secs) : `${minutes}${String(secs).padStart(2, "0")}`;
}

/**
 * The next digit string from the input's raw value: typing, Backspace and paste all come through here. Non-digits
 * and leading zeros are dropped; more than `CLOCK_DIGITS_MAX` digits keeps `prev`.
 */
export function nextDigits(prev: string, inputValue: string): string {
  const digits = inputValue.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length > CLOCK_DIGITS_MAX ? prev : digits;
}
