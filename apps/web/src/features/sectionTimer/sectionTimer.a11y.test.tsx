import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../test/axe";
import { ClockField } from "./ClockField";
import { fieldsFromTimer, type TimerFieldsValue } from "./timerFields";
import { TimerFields } from "./TimerFieldGroup";

// Vitest does not hand back raw CSS through import.meta.glob, so read the stylesheet (as workouts/a11y.test.tsx does).
const HERE = dirname(fileURLToPath(import.meta.url));
const css = new Proxy({} as Record<string, string>, { get: (_t, file: string) => readFileSync(join(HERE, file), "utf8") });
function hasTapTarget(file: string, selector: string): boolean {
  const source = css[file]?.replace(/\/\*[\s\S]*?\*\//g, "");
  if (source === undefined) throw new Error(`no stylesheet ${file}`);
  return [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
    ([, selectors = "", body = ""]) =>
      selectors.split(/,(?![^(]*\))/).some((s) => s.trim() === selector) && /min-height:\s*var\(--tap-target-min\)/.test(body),
  );
}

const values: [string, TimerFieldsValue][] = [
  ["none", fieldsFromTimer(null)],
  ["set_timer", fieldsFromTimer({ format: "set_timer", roundSeconds: 300, rounds: 5 })],
  ["amrap", fieldsFromTimer({ format: "amrap", capSeconds: 720 })],
  ["time_cap", fieldsFromTimer({ format: "time_cap", capSeconds: null })],
];

describe("10.7 AC59 — sectionTimer accessibly", () => {
  afterEach(() => document.documentElement.removeAttribute("data-theme"));

  it.each(["light", "dark"])("the clock field, plain, with a hint and with an error (%s)", async (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const { container } = render(
      <>
        <ClockField id="a" label="Round length" digits="" onChange={() => {}} />
        <ClockField id="b" label="Cap" hint="Leave empty for For Time, with no cap." digits="900" onChange={() => {}} />
        <ClockField id="c" label="Time limit" digits="375" error="Seconds go up to 59." onChange={() => {}} />
      </>,
    );
    await expectNoAxeViolations(container);
  });

  it.each(["light", "dark"].flatMap((theme) => values.map(([f, v]) => [theme, f, v] as const)))("TimerFields (%s, %s)", async (theme, _f, value) => {
    document.documentElement.setAttribute("data-theme", theme);
    const { container } = render(<TimerFields idPrefix="t" value={value} errors={{ group: "Check the timer and try again." }} onChange={() => {}} />);
    await expectNoAxeViolations(container);
  });

  it.each([".input", ".select"])("%s is at least a tap target tall", (selector) => {
    expect(hasTapTarget("./sectionTimer.module.css", selector)).toBe(true);
  });
});
