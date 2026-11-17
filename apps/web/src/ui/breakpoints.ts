/**
 * Spec 17.12 AC1: the one `matchMedia` string for the desktop layout. It repeats `--bp-desktop` (`tokens.css`) as a
 * literal, because a custom property can't be read inside a media condition; `breakpoints.test.ts` keeps them equal.
 */
export const DESKTOP_QUERY = "(min-width: 64rem)";
