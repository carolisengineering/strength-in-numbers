import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Field } from "../../ui/Field";
import { HevyError } from "./client/hevyErrors";
import {
  CANCEL,
  HEVY_COPY,
  KEY_CARD_TITLE,
  KEY_HELPER,
  KEY_LABEL,
  KEY_NOT_REMEMBERED,
  KEY_REMOVED,
  KEY_SAVED,
  KEY_SAVED_VISIT,
  KEY_STAYS,
  LOADING_USERNAME,
  QUIET_MINUTE,
  REMOVE,
  REMOVE_BODY,
  REMOVE_TITLE,
  REPLACE,
  SAVE_AND_REMEMBER,
  USE_FOR_VISIT,
  keyEnding,
  signedInAs,
} from "./messages";
import { useHevyKey } from "./useHevyKey";
import { useHevyUser } from "./useHevyUser";
import { inQuietMinute, msUntilQuietChange } from "./client/pacer";
import styles from "./HevyKeyCard.module.css";

const KEY_INPUT_ID = "hevy-key";

/**
 * Spec 20.0 AC3–AC6, §5.1: paste a Hevy key, check it with Hevy, keep it on this device. With a key, the card shows
 * only its last four and who it signs in as, with Replace and Remove; the pasted value lives only in this field's
 * state and is cleared after a save. Outcomes are announced in one polite status line that is empty at first paint.
 */
export function HevyKeyCard() {
  const key = useHevyKey();
  const user = useHevyUser();
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<"remember" | "visit" | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0, at: 0 });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // Minor 199: while a save waits, re-check the quiet minute when it next starts or ends, not once per render.
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    if (busy === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const now = Date.now();
      setQuiet(inQuietMinute(now));
      timer = setTimeout(check, msUntilQuietChange(now));
    };
    check();
    return () => {
      clearTimeout(timer);
      // The next save starts from "not quiet", so its first render never shows a stale line (code review).
      setQuiet(false);
    };
  }, [busy]);

  const announce = (text: string) => setAnnouncement((a) => ({ text, seq: a.seq + 1, at: Date.now() }));
  // After the line has rendered its new text (and the form has unmounted), so focus lands on the words.
  useEffect(() => {
    if (announcement.seq > 0) statusRef.current?.focus();
  }, [announcement.seq]);

  async function save(remember: boolean) {
    setBusy(remember ? "remember" : "visit");
    setError(undefined);
    const result = await key.save(draft, { remember });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft("");
    setReplacing(false);
    announce(!remember ? KEY_SAVED_VISIT : result.remembered ? KEY_SAVED : KEY_NOT_REMEMBERED);
  }

  function remove() {
    setConfirmRemove(false);
    key.remove();
    setReplacing(false);
    setDraft("");
    setError(undefined);
    announce(KEY_REMOVED);
  }

  const showField = !key.hasKey || replacing;
  const username = user.data?.data.username ?? user.data?.data.name ?? null;
  const userFailure = user.error instanceof HevyError ? (user.error.kind === "not_found" ? HEVY_COPY.bad_key : HEVY_COPY[user.error.kind]) : null;
  // Minor 171: whichever came last, an outcome this visit or Hevy refusing the stored key after it.
  const statusText = userFailure !== null && (announcement.text === "" || user.errorUpdatedAt > announcement.at) ? userFailure : announcement.text;
  // Minor 203: a refusal the status line is not showing (a newer outcome took it) stays named under the ending.
  const refusalUnderEnding = userFailure === HEVY_COPY.bad_key && statusText !== userFailure;

  return (
    <section className={styles.card} aria-labelledby="hevy-key-title">
      <h2 className={styles.title} id="hevy-key-title">
        {KEY_CARD_TITLE}
      </h2>

      {key.hasKey && key.lastFour !== null ? (
        <div className={styles.current}>
          <p className={styles.ending}>{keyEnding(key.lastFour)}</p>
          {/* Minor 203: a key Hevy refuses stays named here once a newer outcome takes the status line (never both at
              once). Not live (the status line announces), and only the refusal: a network failure is the status line's. */}
          {refusalUnderEnding ? <p className={styles.failure}>{userFailure}</p> : null}
          {username !== null ? <p className={styles.who}>{signedInAs(username)}</p> : null}
          {username === null && user.isPending && user.fetchStatus === "fetching" ? <p className={styles.who}>{LOADING_USERNAME}</p> : null}
          {!replacing ? (
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setReplacing(true)}>
                {REPLACE}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
                {REMOVE}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showField ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save(true);
          }}
        >
          <Field id={KEY_INPUT_ID} label={KEY_LABEL} hint={KEY_HELPER} error={error}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          </Field>
          <p className={styles.stays}>{KEY_STAYS}</p>
          {/* Minor 199: mounted from the start, so the line is announced when the quiet minute begins mid-save. */}
          <p className={`${styles.stays} ${styles.quiet}`} aria-live="polite" data-testid="hevy-quiet-minute">
            {busy !== null && quiet ? QUIET_MINUTE : ""}
          </p>
          <div className={styles.actions}>
            <Button type="submit" busy={busy === "remember"} disabled={busy !== null}>
              {SAVE_AND_REMEMBER}
            </Button>
            <Button type="button" variant="secondary" busy={busy === "visit"} disabled={busy !== null} onClick={() => void save(false)}>
              {USE_FOR_VISIT}
            </Button>
            {replacing ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setReplacing(false);
                  setDraft("");
                  setError(undefined);
                }}
              >
                {CANCEL}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <p className={styles.status} role="status" tabIndex={-1} ref={statusRef} data-testid="hevy-key-status">
        {/* Minor 171: a stored key that Hevy now refuses is announced here too, after the last outcome. */}
        {statusText}
      </p>

      <ConfirmDialog
        open={confirmRemove}
        title={REMOVE_TITLE}
        confirmLabel={REMOVE}
        variant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>{REMOVE_BODY}</p>
      </ConfirmDialog>
    </section>
  );
}
