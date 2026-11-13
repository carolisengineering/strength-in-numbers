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

describe("10.7 AC1 / minor 315 — a pasted h:mm:ss reads as hours", () => {
  it("1:30:00 is 90:00 and 0:45:30 is 45:30", () => {
    expect(nextDigits("", "1:30:00")).toBe("9000");
    expect(digitsToText(nextDigits("", "1:30:00"))).toBe("90:00");
    expect(nextDigits("", "0:45:30")).toBe("4530");
  });

  it("an h:mm:ss over the field's five digits keeps the old value", () => {
    expect(nextDigits("12", "20:00:00")).toBe("12");
  });

  it("anything with one colon or none reads as today: typing and other pastes fill from the right", () => {
    expect(nextDigits("34", "0:341")).toBe("341");
    expect(nextDigits("", "1:30")).toBe("130");
    expect(nextDigits("", "13000")).toBe("13000");
    expect(nextDigits("", "1:3:00")).toBe("1300");
  });
});
