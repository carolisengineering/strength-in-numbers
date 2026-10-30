import type { HevyLinkState } from "@sin/core";

import type { SendIntent, SendOutcome } from "./runSend";

/**
 * The outcomes that stay on screen until the next run: the ones that ask the lifter to do something (§6.1). A
 * follow-up's needs-pairing is one (minor 258): it holds the claim, so closing the sheet must leave a way on.
 */
export type OverlayOutcome =
  | Extract<SendOutcome, { kind: "unsure" | "inconclusive" | "unrecorded" | "in-progress" | "failed" | "already-linked" | "copy-gone" | "refused" }>
  | (Extract<SendOutcome, { kind: "needs-pairing" }> & { retry: SendIntent });
const OVERLAYS: ReadonlySet<SendOutcome["kind"]> = new Set(["unsure", "inconclusive", "unrecorded", "in-progress", "failed", "already-linked", "copy-gone", "refused"]);
const isOverlay = (o: SendOutcome): o is OverlayOutcome => OVERLAYS.has(o.kind) || (o.kind === "needs-pairing" && o.retry !== undefined);

export type SectionView =
  | { kind: "hidden" }
  | { kind: "none" }
  | { kind: "sending" }
  | { kind: "sent"; label: "sent" | "fromHevy" | "matched"; syncedAt: string | null }
  | { kind: "changed" }
  | { kind: "outcome"; outcome: OverlayOutcome; base: HevyLinkState["state"] };

/**
 * Spec 20.2 §6.1, AC2: what the section shows, from the server's link and this device's latest send. A run in flight
 * reads "Sending…"; an outcome that asks for an action overlays the link's state; `done` and `not-sent` defer to the
 * refetched link; a `gone` workout (deleted mid-send) hides the section, the screen's own not-found view takes over.
 * Pure.
 */
export function sectionView(input: { status: "ok" | "hidden"; link: HevyLinkState | "error" | "pending"; pending: boolean; last: SendOutcome | null }): SectionView {
  const { status, link, pending, last } = input;
  if (status !== "ok" || link === "error" || link === "pending" || last?.kind === "gone") return { kind: "hidden" };
  if (pending) return { kind: "sending" };
  if (last !== null && isOverlay(last)) return { kind: "outcome", outcome: last, base: link.state };
  switch (link.state) {
    case "none":
      return { kind: "none" };
    case "sending":
      return { kind: "sending" };
    case "sent":
      return { kind: "sent", label: link.origin === "imported" ? "fromHevy" : link.origin === "matched" ? "matched" : "sent", syncedAt: link.syncedAt };
    case "changed":
      return { kind: "changed" };
  }
}
