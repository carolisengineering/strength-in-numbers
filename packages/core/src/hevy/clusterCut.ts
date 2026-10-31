/**
 * The Hevy import's one text cut (minors 136, 146, 205, 206, 209): section names and notes, titles and notes. No `Intl`
 * (Spec 19.1 AC14), so the cluster rules are hand-written. A cut keeps whole: a surrogate pair; a ZWJ sequence; a letter
 * with its combining marks, variation selectors, skin-tone modifiers and tag characters; a flag's two regional
 * indicators; a Hangul syllable written as conjoining jamo (UAX #29 GB6–GB8). It does not know Devanagari conjuncts
 * (`क्|ष`) or prepend characters, so it can split those. It may end a little shorter than a true grapheme cut; it is
 * never longer.
 */

const ZWJ = 0x200d;
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const MARK = /^\p{M}$/u;

/** A code point that continues the cluster before it: a combining mark, ZWJ, a variation selector, a skin-tone
 * modifier or an emoji tag character. */
function extendsCluster(point: string): boolean {
  const cp = point.codePointAt(0)!;
  return (
    MARK.test(point) ||
    cp === ZWJ ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f)
  );
}

type Jamo = "L" | "V" | "T" | "LV" | "LVT" | null;
/** The Hangul syllable type of a code point (UAX #29), or null. */
function jamoOf(cp: number): Jamo {
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c)) return "L";
  if ((cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6)) return "V";
  if ((cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb)) return "T";
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 === 0 ? "LV" : "LVT";
  return null;
}
/** GB6: L × (L | V | LV | LVT); GB7: (LV | V) × (V | T); GB8: (LVT | T) × T. */
function joinsHangul(before: Jamo, after: Jamo): boolean {
  if (before === null || after === null) return false;
  if (before === "L") return after !== "T";
  if (before === "LV" || before === "V") return after === "V" || after === "T";
  return after === "T";
}

const isLoneHigh = (point: string) => point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdbff;

/** Whether a cut between `before` (code points kept) and `next` (the first one dropped) splits a cluster. */
function splitsCluster(before: readonly string[], next: string | undefined): boolean {
  if (before.length === 0) return false;
  const lastPoint = before[before.length - 1]!;
  // Minor 206: a high surrogate that was already alone in the input is never left at the end of a cut.
  if (isLoneHigh(lastPoint)) return true;
  const last = lastPoint.codePointAt(0)!;
  if (last === ZWJ) return true;
  if (next === undefined) return false;
  if (extendsCluster(next)) return true;
  const nextCp = next.codePointAt(0)!;
  if (joinsHangul(jamoOf(last), jamoOf(nextCp))) return true;
  if (!isRegionalIndicator(last) || !isRegionalIndicator(nextCp)) return false;
  let run = 0;
  for (let i = before.length - 1; i >= 0 && isRegionalIndicator(before[i]!.codePointAt(0)!); i--) run++;
  return run % 2 === 1;
}

/**
 * The longest prefix of at most `max` UTF-16 units (SIN's limits count units) that ends on a cluster boundary as the
 * file comment defines it. Not trimmed; `text` itself when it fits.
 */
export function cutClusters(text: string, max: number): string {
  if (text.length <= max) return text;
  const points = [...text];
  const kept: string[] = [];
  let units = 0;
  for (const p of points) {
    if (units + p.length > max) break;
    kept.push(p);
    units += p.length;
  }
  while (splitsCluster(kept, points[kept.length])) kept.pop();
  return kept.join("");
}
