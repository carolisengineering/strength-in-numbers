import { describe, expect, it } from "vitest";
import { CLOCK_DIGITS_MAX, digitsToSeconds, digitsToText, nextDigits, secondsToDigits } from "./clockDigits";

describe("10.7 AC1 — digits fill from the right (pure)", () => {
  it("typing 3, 4, 1 shows 0:03, 0:34, 3:41", () => {
    const steps: string[] = [];
    let d = "";
    for (const key of "341") {
      d = nextDigits(d, digitsToText(d) + key);
      steps.push(digitsToText(d));
    }
    expect(steps).toEqual(["0:03", "0:34", "3:41"]);
    expect(d).toBe("341");
  });

  it("typing 1 to 5 shows 123:45; a sixth digit is ignored", () => {
    let d = "";
    for (const key of "12345") d = nextDigits(d, digitsToText(d) + key);
    expect(digitsToText(d)).toBe("123:45");
    expect(CLOCK_DIGITS_MAX).toBe(5);
    expect(nextDigits("12345", "123:456")).toBe("12345");
  });

  it("Backspace drops the last digit", () => {
    expect(nextDigits("341", "3:4")).toBe("34");
  });

  it.each<[string, string]>([
    ["3:41", "341"],
    ["341", "341"],
    ["03:41", "341"],
    [" 3:41 ", "341"],
    ["3m41s", "341"],
    ["abc", ""],
    ["0", ""],
  ])("typed or pasted %j gives %j", (input, digits) => {
    expect(nextDigits("", input)).toBe(digits);
  });

  it("a paste of six digits is ignored and the previous value stays", () => {
    expect(nextDigits("341", "123456")).toBe("341");
  });

  it("digitsToText pads the seconds, not the minutes", () => {
    expect(["", "3", "34", "341", "1234", "12345"].map(digitsToText)).toEqual(["", "0:03", "0:34", "3:41", "12:34", "123:45"]);
  });

  it("round trip 1–10 800", () => {
    for (let s = 1; s <= 10_800; s++) {
      const d = secondsToDigits(s);
      expect(d.startsWith("0")).toBe(false);
      expect(digitsToSeconds(d)).toBe(s);
    }
  });
});

describe("10.7 AC2 — seconds go up to 59 (pure)", () => {
  it.each<[string, number | null]>([
    ["375", null],
    ["60", null],
    ["359", 239],
    ["59", 59],
    ["", null],
  ])("digitsToSeconds(%j) is %j", (d, s) => {
    expect(digitsToSeconds(d)).toBe(s);
  });
});
