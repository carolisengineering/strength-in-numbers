import { describe, expect, it } from "vitest";
import { cutClusters } from "../src/hevy/clusterCut.js";

const a = (n: number) => "a".repeat(n);

describe("Minor 205 — Hangul jamo stay one syllable", () => {
  it("L V T: the cut doesn't end before the T", () => expect(cutClusters(`${a(8)}한`, 10)).toBe(a(8)));
  it("L V: the cut doesn't end between L and V", () => expect(cutClusters(`${a(9)}하`, 10)).toBe(a(9)));
  it("LV + T: a precomposed 하 keeps its trailing jamo", () => expect(cutClusters(`${a(9)}한`, 10)).toBe(a(9)));
  it("LVT + T: a precomposed 한 keeps a further trailing jamo", () => expect(cutClusters(`${a(9)}한ᆫ`, 10)).toBe(a(9)));
  it("a precomposed syllable before a new L is a boundary", () => expect(cutClusters(`${a(9)}한ᄒ`, 10)).toBe(`${a(9)}한`));
  it("a whole syllable before the limit is kept", () =>
    expect(cutClusters(`${a(7)}한zz`, 10)).toBe(`${a(7)}한`));
});

describe("Minor 206 — a lone high surrogate is not left at the end", () => {
  it("is dropped", () => expect(cutClusters(`${a(9)}\uD800zzz`, 10)).toBe(a(9)));
  it("a lone one mid-text is passed through as before", () => expect(cutClusters(`a\uD800b${a(20)}`, 5)).toBe(`a\uD800b${a(2)}`));
});

describe("Minor 279 — a lone low surrogate is not left at the end", () => {
  it("is dropped", () => expect(cutClusters(`${a(9)}\uDC00zzz`, 10)).toBe(a(9)));
  it("a lone one mid-text is passed through as before", () => expect(cutClusters(`a\uDC00b${a(20)}`, 5)).toBe(`a\uDC00b${a(2)}`));
});

describe("cutClusters", () => {
  it("text within the limit is returned unchanged", () => expect(cutClusters("abc", 3)).toBe("abc"));
  it("does not trim", () => expect(cutClusters("ab cd", 3)).toBe("ab "));
});
