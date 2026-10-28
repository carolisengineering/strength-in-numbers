import type { HevyPair } from "@sin/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { reportError } from "../../../observability/reportError";
import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { Screen } from "../../../ui/Screen";
import { useCatalog } from "../../catalog/useCatalog";
import { searchByName } from "../../catalog/visibility";
import { HEVY_TYPE_LABELS, RULE_BADGES } from "../labels";
import {
  BACK_TO_HEVY,
  MAPPING_LOAD_FAILED,
  MAPPING_LOADING,
  NO_PAIRINGS,
  PAIRINGS_LOADING,
  PAIRINGS_PATCH_FAILED,
  PAIRINGS_TITLE,
  REMOVE,
  REMOVE_PAIRING,
  REMOVE_PAIRING_TITLE,
  SEARCH_EXERCISES,
  SEND_AS_THIS,
  SENT_AS_THIS,
  UNNAMED_EXERCISE,
  deletedHeading,
  lastPairingBody,
  markersHeading,
  removePairingBody,
  skippedHeading,
  removedDone,
  sentAsDone,
} from "../messages";
import { HEVY_PATH } from "../paths";
import { useHevyMapping } from "../mapping/useHevyMapping";
import { classifyMappingError, mappingErrorMessage, toPairInput, useMappingMutations } from "../mapping/useMappingMutations";
import { groupPairings } from "./pairingGroups";
import styles from "./PairingsScreen.module.css";

/** A pair the owner asked to remove, with the SIN name if it is that exercise's last pairing. */
interface PendingRemove {
  pair: HevyPair;
  lastFor: string | null;
}

/**
 * Spec 20.0 AC24, AC25, §5.3: every stored pairing, grouped by SIN exercise (A–Z, searchable by the SIN name, every
 * row in the DOM — no virtualization), with deleted exercises, skips and section markers apart. "Send as this" and
 * "Remove pairing" are single-pair `PATCH`es; the list changes only from the server's response.
 */
export function PairingsScreen() {
  const mapping = useHevyMapping();
  const { state: catalog } = useCatalog();
  const { patch } = useMappingMutations();
  const [query, setQuery] = useState("");
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Minor 180: one polite status line, empty at first paint; focus moves to it after each write.
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (announcement.seq > 0) statusRef.current?.focus();
  }, [announcement.seq]);

  const groups = useMemo(() => (mapping.data ? groupPairings(mapping.data, catalog.rows, { synced: catalog.syncToken !== null }) : null), [mapping.data, catalog.rows, catalog.syncToken]);
  const shown = useMemo(() => {
    if (groups === null) return [];
    if (query.trim() === "") return groups.exercises;
    const keep = new Set(searchByName(groups.exercises.map((g) => g.exercise), query).map((e) => e.id));
    return groups.exercises.filter((g) => keep.has(g.exercise.id));
  }, [groups, query]);

  function run(body: { upsert?: ReturnType<typeof toPairInput>[]; remove?: string[] }, done: string) {
    setFailure(null);
    patch.mutate(body, {
      onSuccess: () => setAnnouncement((a) => ({ text: done, seq: a.seq + 1 })),
      onError: (err) => {
        const kind = classifyMappingError(err);
        if (kind === "other") reportError(err, { source: "hevy", op: "mapping-patch" });
        setFailure(mappingErrorMessage(err, PAIRINGS_PATCH_FAILED));
      },
    });
  }

  const busy = patch.isPending;
  const pairRow = (pair: HevyPair, opts: { canSend: boolean; lastFor: string | null }) => (
    <li key={pair.hevyTemplateId} className={styles.pair}>
      <span className={styles.hevyTitle}>{pair.hevyTitle}</span>
      <span className={styles.meta}>
        {pair.hevyType !== null ? <span>{HEVY_TYPE_LABELS[pair.hevyType]}</span> : null}
        {pair.measureRule !== null ? <span className={styles.badge}>{RULE_BADGES[pair.measureRule]}</span> : null}
        {opts.canSend && pair.exportAs ? <span className={styles.badge}>{SENT_AS_THIS}</span> : null}
      </span>
      <span className={styles.actions}>
        {opts.canSend && !pair.exportAs ? (
          <Button variant="secondary" disabled={busy} aria-label={`${SEND_AS_THIS}: ${pair.hevyTitle}`} onClick={() => run({ upsert: [{ ...toPairInput(pair), exportAs: true }] }, sentAsDone(pair.hevyTitle))}>
            {SEND_AS_THIS}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} aria-label={`${REMOVE_PAIRING}: ${pair.hevyTitle}`} onClick={() => setPendingRemove({ pair, lastFor: opts.lastFor })}>
          {REMOVE_PAIRING}
        </Button>
      </span>
    </li>
  );

  return (
    <Screen title={PAIRINGS_TITLE} lead={<BackLink to={HEVY_PATH} label={BACK_TO_HEVY} />}>
      {mapping.isPending ? <p className={styles.muted}>{MAPPING_LOADING}</p> : null}
      {mapping.isError ? <p role="alert">{MAPPING_LOAD_FAILED}</p> : null}
      {groups !== null ? (
        <div className={styles.body}>
          <input
            className={styles.search}
            type="search"
            aria-label={SEARCH_EXERCISES}
            placeholder={`${SEARCH_EXERCISES}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {failure !== null ? <p role="alert">{failure}</p> : null}
          {groups.loading.length > 0 ? <p className={styles.muted}>{PAIRINGS_LOADING}</p> : null}
          {groups.exercises.length + groups.deleted.length + groups.skipped.length + groups.placeholders.length + groups.loading.length === 0 ? (
            <p className={styles.muted}>{NO_PAIRINGS}</p>
          ) : null}

          {shown.map(({ exercise, pairs }) => (
            <section key={exercise.id} className={styles.group} aria-label={exercise.name}>
              <h2 className={styles.name}>{exercise.name}</h2>
              <ul className={styles.list}>{pairs.map((pair) => pairRow(pair, { canSend: true, lastFor: pairs.length === 1 ? exercise.name : null }))}</ul>
            </section>
          ))}

          {groups.skipped.length > 0 ? (
            <section className={styles.group} aria-label={skippedHeading(groups.skipped.length)}>
              <h2 className={styles.name}>{skippedHeading(groups.skipped.length)}</h2>
              <ul className={styles.list}>
                {groups.skipped.map((pair) => (
                  <li key={pair.hevyTemplateId} className={styles.pair}>
                    <span className={styles.hevyTitle}>{pair.hevyTitle}</span>
                    <Button variant="secondary" disabled={busy} aria-label={`${REMOVE}: ${pair.hevyTitle}`} onClick={() => setPendingRemove({ pair, lastFor: null })}>
                      {REMOVE}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.placeholders.length > 0 ? (
            <section className={styles.group} aria-label={markersHeading(groups.placeholders.length)}>
              <h2 className={styles.name}>{markersHeading(groups.placeholders.length)}</h2>
              <p className={styles.muted}>{groups.placeholders.map((p) => p.hevyTitle).join(" · ")}</p>
            </section>
          ) : null}

          {groups.deleted.length > 0 ? (
            <section className={styles.group} aria-label={deletedHeading(groups.deleted.length)}>
              <h2 className={styles.name}>{deletedHeading(groups.deleted.length)}</h2>
              {groups.deleted.map((d) => (
                <div key={d.exerciseId}>
                  <p className={styles.muted}>{d.name ?? UNNAMED_EXERCISE}</p>
                  <ul className={styles.list}>{d.pairs.map((pair) => pairRow(pair, { canSend: false, lastFor: null }))}</ul>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      <p className={styles.status} role="status" tabIndex={-1} ref={statusRef} data-testid="hevy-pairings-status">
        {announcement.text}
      </p>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={REMOVE_PAIRING_TITLE}
        confirmLabel={REMOVE_PAIRING}
        variant="danger"
        onConfirm={() => {
          if (pendingRemove !== null) run({ remove: [pendingRemove.pair.hevyTemplateId] }, removedDone(pendingRemove.pair.hevyTitle));
          setPendingRemove(null);
        }}
        onCancel={() => setPendingRemove(null)}
      >
        {pendingRemove !== null ? (
          <p>{pendingRemove.lastFor !== null ? lastPairingBody(pendingRemove.lastFor) : removePairingBody(pendingRemove.pair.hevyTitle)}</p>
        ) : null}
      </ConfirmDialog>
    </Screen>
  );
}
