/**
 * Minor 780: the Hevy screens' counts ("1,234 workouts"), grouped the en-US way to match the rest of their copy. The one
 * `toLocaleString` the date scan exempts in these screens (`ui/dateText.scan.test.ts`), so it holds nothing else.
 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
