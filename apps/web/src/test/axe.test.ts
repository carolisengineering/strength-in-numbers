import { afterEach, describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "./axe";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("Minor 9 — expectNoAxeViolations", () => {
  it("passes clean markup", async () => {
    await expectNoAxeViolations(mount(`<main><h1>Edit workout</h1><label>Title <input id="t" /></label></main>`));
  });

  it("fails an unlabeled input, naming the rule and the target", async () => {
    await expect(expectNoAxeViolations(mount(`<main><h1>Edit workout</h1><input id="unlabeled" /></main>`))).rejects.toThrow(/label: #unlabeled/);
  });

  it("an exclusion drops only its own rule on its own selector", async () => {
    const root = mount(`<main><h1>Edit workout</h1><input id="known" /><input id="other" /></main>`);
    await expect(expectNoAxeViolations(root, [{ rule: "label", selector: "#known", minor: 0 }])).rejects.toThrow(/#other/);
    await expect(expectNoAxeViolations(root, [{ rule: "label", selector: "#known", minor: 0 }])).rejects.not.toThrow(/#known/);
    await expectNoAxeViolations(root, [
      { rule: "label", selector: "#known", minor: 0 },
      { rule: "label", selector: "#other", minor: 0 },
    ]);
  });
});
