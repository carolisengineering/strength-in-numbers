import axe from "axe-core";

/** One known violation left in place: one rule on one selector, with the deferred minor that owns its fix. */
export interface AxeExclusion {
  readonly rule: string;
  readonly selector: string;
  readonly minor: number;
}

/**
 * Minor 9 (#161): runs axe over `root` and fails listing each violation's rule id and target. `color-contrast` is off:
 * jsdom has no layout or computed colors, so contrast stays a phone or screens-harness check. An exclusion drops only
 * the nodes of its one rule that match its one selector; anything else still fails.
 */
export async function expectNoAxeViolations(root: Element, exclusions: readonly AxeExclusion[] = []): Promise<void> {
  const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  const found = results.violations.flatMap((violation) =>
    violation.nodes
      .filter((node) => !exclusions.some((x) => x.rule === violation.id && node.target.some((t) => typeof t === "string" && t === x.selector)))
      .map((node) => `${violation.id}: ${node.target.join(" ")} — ${violation.help}`),
  );
  if (found.length > 0) throw new Error(`axe found ${found.length} violation(s):\n${found.join("\n")}`);
}
