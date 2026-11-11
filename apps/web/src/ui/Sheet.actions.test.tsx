import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useId, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { sheetBody, sheetRow } from "../test/sheetHelpers";

import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { SheetActions } from "./SheetActions";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Sheet.module.css"), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function rowButtons(): string[] {
  return sheetRow()
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

/** A form sheet as a caller writes one: its own form, its buttons through SheetActions. */
function FormSheet({
  open = true,
  onSubmit = vi.fn(),
  onClose = vi.fn(),
  saveDisabled = false,
  withDanger = true,
}: {
  open?: boolean;
  onSubmit?: () => void;
  onClose?: () => void;
  saveDisabled?: boolean;
  withDanger?: boolean;
}) {
  const formId = useId();
  return (
    <Sheet open={open} title="Edit set" onClose={onClose}>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          Weight
          <input />
        </label>
        <label>
          Notes
          <textarea />
        </label>
      </form>
      <SheetActions
        danger={
          withDanger ? (
            <Button variant="danger" onClick={vi.fn()}>
              Delete set
            </Button>
          ) : undefined
        }
        primary={
          <Button type="submit" form={formId} disabled={saveDisabled}>
            Save
          </Button>
        }
      />
    </Sheet>
  );
}

describe("17.10 AC1 — Sheet owns the row; sheets fill its slots", () => {
  it("holds danger, Cancel, primary in that order, outside the body", () => {
    render(<FormSheet />);

    expect(rowButtons()).toEqual(["Delete set", "Cancel", "Save"]);
    expect(within(sheetBody()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(sheetBody()).queryByRole("button", { name: "Delete set" })).toBeNull();
    expect(within(sheetBody()).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("a sheet with no SheetActions still has Cancel", () => {
    render(
      <Sheet open title="Pick" onClose={vi.fn()}>
        <p>list</p>
      </Sheet>,
    );
    expect(rowButtons()).toEqual(["Cancel"]);
  });

  it("dismissLabel renames the dismiss button", () => {
    render(<Sheet open title="Pick" onClose={vi.fn()} dismissLabel="Back" />);
    expect(rowButtons()).toEqual(["Back"]);
  });

  it("noActionRow draws no row (Phase B's sheets until they migrate)", () => {
    render(<Sheet open title="Pick" onClose={vi.fn()} noActionRow />);
    expect(document.querySelector("[data-sheet-actions]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("SheetActions outside a Sheet throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<SheetActions primary={<Button>Save</Button>} />)).toThrow(
      "SheetActions must be inside a Sheet",
    );
  });
});

describe("17.10 AC2 — one layout", () => {
  it("the row has exactly one primary button, and it is last", () => {
    render(<FormSheet />);
    const buttons = sheetRow().getAllByRole("button");
    expect(buttons.filter((b) => b.dataset.variant === "primary")).toHaveLength(1);
    expect(buttons.at(-1)?.dataset.variant).toBe("primary");
  });

  it("buttons share the width equally and wrap rather than clip", () => {
    expect(ruleOf(".buttons")).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleOf(".buttons button")).toMatch(/flex:\s*1 1 0/);
  });
});

describe("17.10 AC3 — dismiss is the same as Close", () => {
  it("Cancel calls onClose once", async () => {
    const onClose = vi.fn();
    render(<FormSheet onClose={onClose} />);
    await userEvent.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while not dismissible, Cancel is aria-disabled (not disabled), does nothing and keeps focus", async () => {
    const onClose = vi.fn();
    render(<Sheet open title="Details" onClose={onClose} dismissible={false} />);
    const cancel = sheetRow().getByRole("button", { name: "Cancel" });

    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    await userEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    expect(cancel).toHaveFocus();
  });

  it("onDismiss runs in place of onClose for the row's button; Close still calls onClose", async () => {
    const onClose = vi.fn();
    const onDismiss = vi.fn();
    render(<Sheet open title="New exercise" onClose={onClose} onDismiss={onDismiss} />);

    await userEvent.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("17.10 AC4 — status line and notice", () => {
  it("status shows above the buttons and is not a live region", () => {
    render(
      <Sheet open title="Edit set" onClose={vi.fn()}>
        <SheetActions status={<span>Needs a name and a type.</span>} primary={<Button>Save</Button>} />
      </Sheet>,
    );
    const line = sheetRow().getByText("Needs a name and a type.");
    const status = line.closest("[data-sheet-status]") as HTMLElement;
    expect(status).not.toBeNull();
    expect(status).not.toHaveAttribute("role");
    expect(status).not.toHaveAttribute("aria-live");
    const save = sheetRow().getByRole("button", { name: "Save" });
    expect(status.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("notice shows above status and keeps the caller's role=alert (a failed save stays in view)", () => {
    render(
      <Sheet open title="Edit set" onClose={vi.fn()}>
        <SheetActions
          notice={<p role="alert">Couldn't save. Try again.</p>}
          status={<span>status text</span>}
          primary={<Button>Save</Button>}
        />
      </Sheet>,
    );
    const alert = sheetRow().getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't save. Try again.");
    const status = sheetRow().getByText("status text");
    expect(alert.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the notice and status boxes take no room while empty", () => {
    expect(css).toMatch(/\.notice:empty[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.status:empty[^{]*\{[^}]*display:\s*none/);
    expect(ruleOf(".status")).toMatch(/color:\s*var\(--color-muted\)/);
    expect(ruleOf(".status")).toMatch(/font-size:\s*var\(--font-size-sm\)/);
    expect(ruleOf(".status")).toMatch(/text-align:\s*center/);
  });
});

// Vitest loads no CSS, so the rule text is the contract (as #206's test in Sheet.test.tsx does).
describe("17.10 AC5, AC8, AC9, AC11, AC12 — the row's CSS", () => {
  it("AC5 / AC12: the dialog never scrolls; the panel is a flex column whose body scrolls and whose row does not", () => {
    expect(ruleOf(".sheet[open]")).toMatch(/overflow:\s*hidden/);
    const panel = ruleOf(".panel");
    expect(panel).toMatch(/flex:\s*1/);
    expect(panel).toMatch(/min-height:\s*0/);
    expect(panel).toMatch(/display:\s*flex/);
    expect(panel).toMatch(/flex-direction:\s*column/);
    expect(ruleOf(".body")).toMatch(/overflow-y:\s*auto/);
    expect(ruleOf(".body")).toMatch(/min-height:\s*0/);
    expect(ruleOf(".actions")).toMatch(/flex:\s*none/);
  });

  it("AC11: the row is a sibling, never sticky or an overlay; the body pads its scroll", () => {
    const actions = ruleOf(".actions");
    expect(actions).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
    expect(css).not.toMatch(/position:\s*sticky/);
    expect(ruleOf(".body")).toMatch(/scroll-padding-block:\s*var\(--space-4\)/);
    const body = sheetBodyAndRow();
    expect(body.row.parentElement).toBe(body.body.parentElement);
  });

  it("AC9: with the keyboard down the row's bottom padding adds the home-indicator inset", () => {
    const actions = ruleOf(".actions");
    expect(actions).toMatch(/padding:[^;]*calc\(var\(--space-3\) \+ env\(safe-area-inset-bottom\)\)/);
    expect(actions).toMatch(/background:\s*var\(--color-bg\)/);
    expect(actions).toMatch(/border-top:\s*1px solid var\(--color-line\)/);
  });

  it("AC8: with the keyboard up the row's bottom padding drops the inset", () => {
    const rule = ruleOf(':global(:root[data-keyboard="open"]) .actions');
    expect(rule).toMatch(/padding-bottom:\s*var\(--space-3\)/);
    expect(rule).not.toMatch(/safe-area/);
  });
});

function sheetBodyAndRow() {
  render(<FormSheet />);
  return {
    body: sheetBody(),
    row: document.querySelector("dialog[open] [data-sheet-actions]") as HTMLElement,
  };
}

describe("17.10 AC6 — submit from the row", () => {
  it("the row's Save submits the sheet's form once through form={id}", async () => {
    const onSubmit = vi.fn();
    render(<FormSheet onSubmit={onSubmit} />);
    const save = sheetRow().getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.form).not.toBeNull();
    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a disabled Save does not submit", async () => {
    const onSubmit = vi.fn();
    render(<FormSheet onSubmit={onSubmit} saveDisabled />);
    await userEvent.click(sheetRow().getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter in a textarea adds a line and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<FormSheet onSubmit={onSubmit} />);
    const notes = screen.getByLabelText("Notes");
    await userEvent.type(notes, "one{Enter}two");
    expect(notes).toHaveValue("one\ntwo");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("17.10 AC10 — focus order", () => {
  it("Tab goes Close, the body's fields, then danger, Cancel, primary", async () => {
    const user = userEvent.setup();
    render(<FormSheet />);
    screen.getByRole("button", { name: "Close" }).focus();

    await user.tab();
    expect(screen.getByLabelText("Weight")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Notes")).toHaveFocus();
    await user.tab();
    expect(sheetRow().getByRole("button", { name: "Delete set" })).toHaveFocus();
    await user.tab();
    expect(sheetRow().getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(sheetRow().getByRole("button", { name: "Save" })).toHaveFocus();
  });
});

describe("17.10 AC17 — 06.0 AC24's guards hold with the row", () => {
  it("Close is still first in DOM order, before the body and the row", () => {
    render(<FormSheet />);
    const close = screen.getByRole("button", { name: "Close" });
    const field = screen.getByLabelText("Weight");
    const cancel = sheetRow().getByRole("button", { name: "Cancel" });
    expect(close.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Escape calls onClose, never onDismiss", async () => {
    const onClose = vi.fn();
    const onDismiss = vi.fn();
    render(<Sheet open title="New exercise" onClose={onClose} onDismiss={onDismiss} />);
    const cancel = new Event("cancel", { cancelable: true });
    screen.getByRole("dialog").dispatchEvent(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(cancel.defaultPrevented).toBe(true);
  });
});

describe("17.10 AC18 — the row uses existing tokens only", () => {
  const ROW_RULES = [".panel", ".body", ".actions", ':global(:root[data-keyboard="open"]) .actions', ".status", ".buttons", ".buttons button", ".slot"];
  const ALLOWED = /^--(space-\d+|tap-target-min|color-bg|color-line|color-muted|font-size-sm)$/;

  it("every var() in the row's rules is an allowed token, and none writes a color", () => {
    for (const selector of ROW_RULES) {
      const rule = ruleOf(selector);
      expect(rule, selector).not.toBe("");
      for (const [, name] of rule.matchAll(/var\((--[\w-]+)\)/g)) expect(name, `${selector} uses ${name}`).toMatch(ALLOWED);
      expect(rule, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
});

describe("17.10 AC1 — closing and reopening (Review Focus 3)", () => {
  function Host({ onSubmit }: { onSubmit: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen((o) => !o)}>
          toggle
        </button>
        <FormSheet open={open} onSubmit={onSubmit} withDanger={false} />
      </>
    );
  }

  it("a reopened sheet has exactly one Save in a fresh row, and it still submits", async () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    const toggle = screen.getByRole("button", { name: "toggle" });

    await userEvent.click(toggle);
    expect(document.querySelector("[data-sheet-actions]")).toBeNull();
    await userEvent.click(toggle);

    expect(sheetRow().getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    await userEvent.click(sheetRow().getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
