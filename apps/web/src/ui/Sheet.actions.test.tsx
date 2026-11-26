import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useId, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { sheetBody, sheetError, sheetRow } from "../test/sheetHelpers";

import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { SheetActions, sheetError as failure, useShownFailure, type SheetError } from "./SheetActions";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Sheet.module.css"), "utf8");
const tokens = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

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

  it("a save failure shows above status (a failed save stays in view)", () => {
    render(
      <Sheet open title="Edit set" onClose={vi.fn()}>
        <SheetActions error={failure("Couldn't save. Try again.")} status={<span>status text</span>} primary={<Button>Save</Button>} />
      </Sheet>,
    );
    expect(sheetError()).toBe("Couldn't save. Try again.");
    const region = document.querySelector("dialog[open] [data-sheet-error]") as HTMLElement;
    const status = sheetRow().getByText("status text");
    expect(region.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("minor 558 — a new failure object is announced, even with the same words", () => {
    /** Every value the two-step renders, in order: what the region shows on each commit. */
    function track(first: SheetError | null) {
      const seen: (SheetError | null)[] = [];
      const hook = renderHook(({ error }: { error: SheetError | null }) => {
        const shown = useShownFailure(error);
        seen.push(shown);
        return shown;
      }, { initialProps: { error: first } });
      return { seen, ...hook };
    }

    it("the same failure twice, with no clear in between, renders empty and then the failure again", () => {
      const one = failure("Couldn't save.");
      const { seen, rerender } = track(one);
      seen.length = 0;
      rerender({ error: failure("Couldn't save.") });
      expect(seen.map((s) => s?.text ?? null)).toEqual([null, "Couldn't save."]);
    });

    it("a re-render with the same object never renders empty (Review Focus 1)", () => {
      const one = failure("Couldn't save.");
      const { seen, rerender } = track(one);
      rerender({ error: one });
      rerender({ error: one });
      expect(seen.every((s) => s === one)).toBe(true);
    });

    it("in the sheet: the same words twice end with the failure shown", () => {
      const view = (error: SheetError | null) => (
        <Sheet open title="Edit set" onClose={vi.fn()}>
          <SheetActions error={error} primary={<Button>Save</Button>} />
        </Sheet>
      );
      const { rerender } = render(view(failure("Couldn't save.")));
      expect(sheetError()).toBe("Couldn't save.");
      rerender(view(failure("Couldn't save.")));
      expect(sheetError()).toBe("Couldn't save.");
    });

    it("a failure, a success, then the same words show again (Review Focus 2)", () => {
      const view = (error: SheetError | null) => (
        <Sheet open title="Edit set" onClose={vi.fn()}>
          <SheetActions error={error} primary={<Button>Save</Button>} />
        </Sheet>
      );
      const { rerender } = render(view(failure("Couldn't save.")));
      rerender(view(null));
      expect(sheetError()).toBe("");
      rerender(view(failure("Couldn't save.")));
      expect(sheetError()).toBe("Couldn't save.");
    });

    it("unmounting in the same act as a re-render with a new failure neither warns nor throws (Review Focus 3)", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const view = (error: SheetError | null) => (
        <Sheet open title="Edit set" onClose={vi.fn()}>
          <SheetActions error={error} primary={<Button>Save</Button>} />
        </Sheet>
      );
      const { rerender, unmount } = render(view(failure("Couldn't save.")));
      act(() => {
        rerender(view(failure("Couldn't save.")));
        unmount();
      });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("the request ID shows under the failure", () => {
      render(
        <Sheet open title="Edit set" onClose={vi.fn()}>
          <SheetActions error={failure("Couldn't save.", "req-123")} primary={<Button>Save</Button>} />
        </Sheet>,
      );
      const region = document.querySelector("dialog[open] [data-sheet-error]") as HTMLElement;
      expect(region.textContent).toContain("req-123");
    });
  });

  it("the status box takes no room while empty; the error region stays rendered (a hidden live region isn't watched)", () => {
    expect(css).not.toMatch(/\.notice:empty/);
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

  // Code review: capping the whole row clipped buttons that wrap to two lines (they can't shrink), so only the messages
  // are capped: at what the frame (`--app-height` while a keyboard is up) has left after a reserve for the header, the
  // buttons and a usable body. About one line on a 232 px frame; no practical cap on a normal one.
  it("minor 492: the notice and status scroll past what the frame leaves them; the row itself has no cap, so no button clips", () => {
    expect(ruleOf(".actions")).not.toMatch(/max-height/);
    const messages = ruleOf(".messages");
    expect(messages).toMatch(/max-height:\s*calc\(var\(--app-height, 100dvh\) - var\(--sheet-messages-reserve\)\)/);
    expect(messages).toMatch(/overflow-y:\s*auto/);
    expect(messages).toMatch(/min-height:\s*0/);
    expect(tokens).toMatch(/--sheet-messages-reserve:\s*13\.25rem;/);
    expect(tokens).not.toMatch(/--sheet-messages-share/);
    expect(ruleOf(".buttons")).toMatch(/flex:\s*none/);
    // The empty box takes no room: the row has no gap, and the box adds its space only when it holds a message.
    expect(ruleOf(".actions")).toMatch(/gap:\s*0/);
    expect(css).toMatch(/\.messages:has\(> :not\(:empty\)\)\s*\{[^}]*margin-bottom:\s*var\(--space-2\)/);
    render(
      <Sheet open title="Edit set" onClose={vi.fn()}>
        <SheetActions error={failure("Couldn't save.")} status={<span>Delete set 2?</span>} primary={<Button>Save</Button>} />
      </Sheet>,
    );
    const box = document.querySelector("dialog[open] [data-sheet-messages]") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box).toContainElement(document.querySelector<HTMLElement>("dialog[open] [data-sheet-error]"));
    expect(box).toContainElement(sheetRow().getByText("Delete set 2?"));
    expect(box).not.toContainElement(sheetRow().getByRole("button", { name: "Save" }));
  });

  // A flex item's default `min-width: auto` is ignored once `flex-basis` is 0, so three buttons squeezed a long label
  // inside its button at 320 px instead of wrapping the row.
  it("minor 490: a button never shrinks below its label, so the row wraps instead of squeezing", () => {
    const button = ruleOf(".buttons button");
    expect(button).toMatch(/flex:\s*1 1 0/);
    // fit-content, not min-content: min-content is the longest word, so "Remove section" still broke between words.
    expect(button).toMatch(/min-width:\s*fit-content/);
    // A three-button row stays on one line at 320 px (the harness's 55b and 63e measure it).
    expect(button).toMatch(/padding-inline:\s*var\(--space-2\)/);
    expect(ruleOf(".buttons")).toMatch(/flex-wrap:\s*wrap/);
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

const sources = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/**
 * A Cancel a sheet could draw (AC16, minor 499): any copy constant named CANCEL, a `.cancel` key on an ALL-CAPS copy
 * object, nested keys allowed (`C.cancel`, `MESSAGES.cancel`, `EDIT_COPY.lastSet.cancel`; minor 751: a method
 * reference such as `controller.cancel` is not copy, and `\b` keeps out `cancelQueries` / `cancelRemove`), and the
 * literal word as a string or as a JSX text child.
 */
const CANCEL_CONSTANTS = /\b[A-Z_]*CANCEL[A-Z_]*\b|\b[A-Z][A-Z_]*(?:\.[A-Za-z_]+)*\.cancel\b|"Cancel"|>\s*Cancel\s*</g;
/** The text before a match that makes it a `dismissLabel` (minor 751: spaces allowed around `=` and inside `{`). */
const DISMISS_LABEL_BEFORE = /dismissLabel\s*=\s*\{?\s*$/;
/** Cancels that act on part of the body, not the sheet (AC7): Match for Hevy's in-card Cancel, in pick and create modes. */
const IN_BODY_CANCELS: Record<string, number> = { "../features/hevy/send/MatchForHevySheet.tsx": 2 };
/** Uses of a Cancel in a file that aren't a `dismissLabel` (import lists name the constants too; only uses count). */
function strayCancels(raw: string): number {
  const source = raw.replace(/^import\b[\s\S]*?\bfrom\s+"[^"]+";$/gm, "");
  let others = 0;
  for (const match of source.matchAll(CANCEL_CONSTANTS)) {
    if (!DISMISS_LABEL_BEFORE.test(source.slice(Math.max(0, match.index - 24), match.index))) others += 1;
  }
  return others;
}
/**
 * A file that renders a Sheet, and each file it imports from its own folder (one hop): a Cancel drawn by a child is
 * the sheet's too. Every same-folder import is read, whether or not it renders anything (minor 751).
 */
function sheetFiles(): string[] {
  const files = new Set<string>();
  for (const [path, raw] of Object.entries(sources)) {
    if (!/<Sheet\b/.test(raw)) continue;
    files.add(path);
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    for (const m of raw.matchAll(/\bfrom\s+"\.\/([^"]+)"/g)) {
      const child = `${dir}${m[1]}.tsx`;
      if (child in sources) files.add(child);
    }
  }
  return [...files].sort();
}

describe("17.10 AC15, AC7 — every sheet uses the row", () => {
  it("no source file names noActionRow (the Phase A opt-out is gone)", () => {
    expect(Object.keys(sources).filter((path) => sources[path]!.includes("noActionRow"))).toEqual([]);
  });

  it("in a sheet or a file it imports from its folder, Cancel is only the sheet's dismissLabel (minor 499)", () => {
    const stray: string[] = [];
    for (const path of sheetFiles()) {
      const others = strayCancels(sources[path]!);
      if (others !== (IN_BODY_CANCELS[path] ?? 0)) stray.push(`${path}: ${others}`);
    }
    expect(stray).toEqual([]);
  });

  it("the literal pattern finds RoutineEditor's own Cancel, outside any sheet", () => {
    expect(strayCancels(sources["../features/routines/RoutineEditor.tsx"]!)).toBeGreaterThanOrEqual(1);
  });

  it("minor 499: a literal Cancel or a Cancel constant in a sheet or its child is found", () => {
    for (const sample of ["<Button>{C.cancel}</Button>", "<button>\n  Cancel\n</button>"]) {
      expect([...sample.matchAll(CANCEL_CONSTANTS)], sample).not.toEqual([]);
    }
  });

  it("minor 751: a method reference isn't a Cancel, and a spaced dismissLabel is", () => {
    for (const sample of ["onCancel={controller.cancel}", "leave.cancel"]) {
      expect([...sample.matchAll(CANCEL_CONSTANTS)], sample).toEqual([]);
    }
    expect(strayCancels("<Sheet dismissLabel = { C.cancel } />")).toBe(0);
    for (const sample of ["EDIT_COPY.lastSet.cancel", "MESSAGES.cancel"]) {
      expect([...sample.matchAll(CANCEL_CONSTANTS)], sample).not.toEqual([]);
    }
  });
});

describe("minors 496, 502, 503 — one save-failure notice", () => {
  /** Text in, one failure object per distinct text (a caller's stored state), so a rerender is not a new failure. */
  function ErrorSheet({ error, requestId }: { error: string | null; requestId?: string | null }) {
    const stored = useMemo(() => (error === null ? null : failure(error, requestId)), [error, requestId]);
    return (
      <Sheet open title="Edit set" onClose={vi.fn()}>
        <SheetActions error={stored} primary={<Button>Save</Button>} />
      </Sheet>
    );
  }
  const region = () => document.querySelector<HTMLElement>("dialog[open] [data-sheet-error]")!;

  it("502: the region is mounted, empty and assertive before any failure (an alert inserted with its text may go unheard)", () => {
    render(<ErrorSheet error={null} />);
    expect(region()).not.toBeNull();
    expect(region()).toBeEmptyDOMElement();
    expect(region()).toHaveAttribute("aria-live", "assertive");
    expect(region()).toHaveAttribute("aria-atomic", "true");
    expect(region()).not.toHaveAttribute("role");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("503: a failure fills the region in InlineNotice's error look, with no role of its own", () => {
    render(<ErrorSheet error="Couldn't save." />);
    expect(sheetError()).toBe("Couldn't save.");
    const notice = region().firstElementChild as HTMLElement;
    expect(notice.className).toMatch(/error/);
    expect(notice).not.toHaveAttribute("role");
  });

  it("review focus 4: a request ID keeps its line", () => {
    render(<ErrorSheet error="Couldn't save." requestId="req-1" />);
    expect(region()).toHaveTextContent("Request ID: req-1");
  });

  it("review focus 1: the same failure twice is heard twice: the region empties between Saves", () => {
    const { rerender } = render(<ErrorSheet error="Couldn't save." />);
    rerender(<ErrorSheet error={null} />);
    expect(region()).toBeEmptyDOMElement();
    rerender(<ErrorSheet error="Couldn't save." />);
    expect(sheetError()).toBe("Couldn't save.");
  });

  it("an empty string is no error", () => {
    render(<ErrorSheet error="" />);
    expect(region()).toBeEmptyDOMElement();
  });
});
