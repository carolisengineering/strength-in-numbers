import type { HevyLinkState, UnmappedExercise, WorkoutDetail } from "@sin/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import { HEVY_PATH } from "../paths";
import { useHevyKey } from "../useHevyKey";
import { useHevyEnabled } from "../useHevyStatus";
import { MatchForHevySheet } from "./MatchForHevySheet";
import { HEVY_SEND_COPY, hevyFailureSentence, noticeSentence, withDay, type SendNotice } from "./messages";
import { HEVY_SEND_KEYS } from "../keys";
import { problemSentence, type SendIntent, type SendOutcome } from "./runSend";
import { sectionView, type OverlayOutcome, type SectionView } from "./sectionState";
import { sentDay } from "./sentDay";
import { useHevyLink } from "./useHevyLink";
import { useSendToHevy } from "./useSendToHevy";
import styles from "./HevyWorkoutSection.module.css";

const C = HEVY_SEND_COPY;
const LABELS = { sent: C.sent, fromHevy: C.fromHevy, matched: C.matched } as const;

function outcomeSentence(outcome: OverlayOutcome): string {
  switch (outcome.kind) {
    case "unsure":
      return outcome.op === "put" ? C.notSureUpdate : C.notSure;
    case "inconclusive":
      return C.inconclusive;
    case "unrecorded":
      return C.couldntRecord;
    case "in-progress":
      return C.inProgress;
    case "already-linked":
      return C.alreadyLinked;
    case "copy-gone":
      return C.copyGone;
    case "refused":
      return problemSentence(outcome.slug) ?? C.generic;
    case "failed":
      return outcome.reason === "server" || outcome.reason === "unknown" ? C.generic : outcome.reason === "network" ? C.network : hevyFailureSentence(outcome.reason);
  }
}

function statusSentence(view: Exclude<SectionView, { kind: "hidden" }>): string {
  switch (view.kind) {
    case "none":
      return C.notYet;
    case "sending":
      return C.sending;
    case "sent":
      return withDay(LABELS[view.label], view.syncedAt === null ? null : sentDay(view.syncedAt));
    case "changed":
      return C.changed;
    case "outcome":
      return outcomeSentence(view.outcome);
  }
}

/** The buttons a view offers (with a key), each with the intent it runs. */
function actionsFor(view: Exclude<SectionView, { kind: "hidden" }>): { label: string; intent: SendIntent | null }[] {
  const base = (state: "none" | "sending" | "sent" | "changed") =>
    state === "none" ? [{ label: C.send, intent: { kind: "send" } as SendIntent }] : state === "sending" ? [{ label: C.send, intent: null }] : state === "changed" ? [{ label: C.update, intent: { kind: "update" } as SendIntent }] : [];
  if (view.kind !== "outcome") return view.kind === "sent" ? [] : base(view.kind);
  const o = view.outcome;
  switch (o.kind) {
    case "unsure":
      return o.op === "put" && o.hevyWorkoutId !== null
        ? [{ label: C.tryAgain, intent: { kind: "retry-update", hevyWorkoutId: o.hevyWorkoutId, fingerprint: o.fingerprint } }]
        : [{ label: C.checkHevy, intent: { kind: "check", fingerprint: o.fingerprint } }];
    case "inconclusive":
      return [
        { label: C.checkAgain, intent: { kind: "check", fingerprint: o.fingerprint } },
        { label: C.sendAnyway, intent: { kind: "send-anyway", fingerprint: o.fingerprint } },
      ];
    case "unrecorded":
      return [{ label: C.tryAgain, intent: { kind: "retry-complete", hevyWorkoutId: o.hevyWorkoutId, fingerprint: o.fingerprint } }];
    case "already-linked":
      return [];
    case "copy-gone":
      return [{ label: C.sendAsNew, intent: { kind: "relink" } }];
    case "in-progress":
      // AC6: the button returns even while another device's claim reads "sending" (a second tap is safe: 409 again).
      return base(view.base === "sending" ? "none" : view.base);
    default:
      return base(view.base);
  }
}

/**
 * Spec 20.2 §5.1, AC1–AC17: the finished-workout screen's Hevy line — the link's state, and Send to Hevy / Update in
 * Hevy and the follow-ups a failure offers. Only for the owner (status `200`); without a key the state shows with a
 * link to the key. The status is a polite live region, empty at first paint and the same node across changes.
 * Notices from a send live in this mount only (AC15).
 */
export function HevyWorkoutSection({ workout }: { workout: WorkoutDetail }) {
  const enabled = useHevyEnabled();
  const { hasKey } = useHevyKey();
  const link = useHevyLink(workout.id);
  const send = useSendToHevy(workout.id);
  const headingId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  /** AC5: from the tap until the run settles (a ref, so two events in one tick start one run). */
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState<{ foundExisting: boolean; notices: SendNotice[] } | null>(null);
  /** This visit's last outcome and the link state it landed on (final review I2). */
  const [landed, setLanded] = useState<{ outcome: SendOutcome; base: HevyLinkState["state"] } | null>(null);
  const queryClient = useQueryClient();
  /** AC13: the exercises to match before the send can go on, and the intent to run once they are. */
  const [pairing, setPairing] = useState<{ unmapped: UnmappedExercise[]; intent: SendIntent } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    if (!returnFocus) return;
    setReturnFocus(false);
    actionsRef.current?.querySelector("button")?.focus();
  }, [returnFocus]);

  // An outcome stands only for this visit, and only while the link still reads as it did when the run ended: once the
  // server has moved on (another device finished, a claim went stale), its state wins.
  const last = landed !== null && link.data !== undefined && landed.base === link.data.state ? landed.outcome : null;
  const view = sectionView({
    status: enabled === "on" ? "ok" : "hidden",
    // A failed refresh keeps the last good link (offline after a failed send still shows the network sentence).
    link: link.data ?? (link.isError ? "error" : "pending"),
    pending: send.pending || busy,
    last,
  });
  if (view.kind === "hidden") return null;

  const run = (intent: SendIntent, leaveOut?: Set<string>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setAfter(null);
    void send
      .run(intent, leaveOut ? { leaveOut } : {})
      .then((outcome) => {
        // The mutation's `onSettled` has refreshed the link by now: record the state this outcome landed on.
        const base = queryClient.getQueryData<HevyLinkState>(HEVY_SEND_KEYS.link(workout.id))?.state ?? null;
        setLanded(base === null ? null : { outcome, base });
        if (outcome.kind === "done") setAfter({ foundExisting: outcome.foundExisting, notices: outcome.notices });
        if (outcome.kind === "needs-pairing") setPairing({ unmapped: outcome.unmapped, intent });
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };

  const actions = actionsFor(view);
  const badKey = view.kind === "outcome" && view.outcome.kind === "failed" && view.outcome.reason === "bad_key";
  const notices = (after?.notices ?? []).map(noticeSentence).filter((s): s is string => s !== null);
  const keyLink = (
    <Link className={styles.link} to={HEVY_PATH}>
      {C.noKeyLink}
    </Link>
  );

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        {C.heading}
      </h2>
      <p className={styles.status} aria-live="polite">
        {mounted ? statusSentence(view) : ""}
      </p>
      {after?.foundExisting ? <p className={styles.text}>{C.foundIt}</p> : null}
      {notices.length > 0 ? (
        <ul className={styles.notices}>
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {!hasKey ? (
        <>
          <p className={styles.text}>{C.noKey}</p>
          {keyLink}
        </>
      ) : (
        <>
          {badKey ? keyLink : null}
          {actions.length > 0 ? (
            <div className={styles.actions} ref={actionsRef}>
              {actions.map((a) => (
                <Button key={a.label} variant="secondary" disabled={a.intent === null || busy || send.pending} onClick={() => a.intent && run(a.intent)}>
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      )}
      {pairing !== null ? (
        <MatchForHevySheet
          unmapped={pairing.unmapped}
          onCancel={() => {
            setPairing(null);
            setReturnFocus(true);
          }}
          onDone={(leaveOut) => {
            const { intent } = pairing;
            setPairing(null);
            run(intent, leaveOut);
          }}
        />
      ) : null}
    </section>
  );
}
