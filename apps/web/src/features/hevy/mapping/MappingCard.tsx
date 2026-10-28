import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import {
  CHOOSE_MARKERS,
  DOWNLOAD_FILE,
  LOAD_FILE,
  MAPPING_CARD_TITLE,
  MAPPING_LOAD_FAILED,
  MAPPING_LOADING,
  NO_MARKERS,
  REVIEW_PAIRINGS,
  markersLine,
  pairedCount,
} from "../messages";
import { PAIRINGS_PATH } from "../paths";
import { useHevyKey } from "../useHevyKey";
import { LoadMappingSheet } from "./LoadMappingSheet";
import { useHevyMapping } from "./useHevyMapping";
import styles from "./MappingCard.module.css";

export interface MappingCardProps {
  /** Task 5: downloads the mapping as a file. */
  onDownload?: () => void;
  /** Task 9: opens the section-marker sheet. */
  onChooseMarkers?: () => void;
}

/**
 * Spec 20.0 AC17, §5.1: the "Exercise pairings" card on the Hevy screen. Counts the exercise pairings, names the
 * section markers, and leads to loading a file, downloading it and reviewing the pairings. Loading needs the key
 * (it reads Hevy's exercise list); the rest needs only the server.
 */
export function MappingCard({ onDownload, onChooseMarkers }: MappingCardProps) {
  const mapping = useHevyMapping();
  const { hasKey } = useHevyKey();
  const [loading, setLoading] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (announcement.seq > 0) statusRef.current?.focus();
  }, [announcement.seq]);

  const pairs = mapping.data?.pairs ?? [];
  const exerciseCount = pairs.filter((p) => p.role === "exercise").length;
  const markers = pairs.filter((p) => p.role === "warmup_placeholder" || p.role === "workout_placeholder").map((p) => p.hevyTitle);

  return (
    <section className={styles.card} aria-labelledby="hevy-mapping-title">
      <h2 className={styles.title} id="hevy-mapping-title">
        {MAPPING_CARD_TITLE}
      </h2>
      {mapping.isPending ? <p className={styles.muted}>{MAPPING_LOADING}</p> : null}
      {mapping.isError ? <p role="alert">{MAPPING_LOAD_FAILED}</p> : null}
      {mapping.isSuccess ? (
        <>
          <p className={styles.count}>{pairedCount(exerciseCount)}</p>
          {markers.length > 0 ? (
            <p className={styles.muted}>{markersLine(markers)}</p>
          ) : (
            <div className={styles.markers}>
              <p className={styles.muted}>{NO_MARKERS}</p>
              <Button variant="secondary" onClick={onChooseMarkers}>
                {CHOOSE_MARKERS}
              </Button>
            </div>
          )}
        </>
      ) : null}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={!hasKey || !mapping.isSuccess} onClick={() => setLoading(true)}>
          {LOAD_FILE}
        </Button>
        <Button variant="secondary" disabled={!mapping.isSuccess} onClick={onDownload}>
          {DOWNLOAD_FILE}
        </Button>
      </div>
      <Link className={styles.review} to={PAIRINGS_PATH}>
        {REVIEW_PAIRINGS}
        <span aria-hidden="true"> ›</span>
      </Link>
      <p className={styles.status} role="status" tabIndex={-1} ref={statusRef} data-testid="hevy-mapping-status">
        {announcement.text}
      </p>
      {mapping.data ? (
        <LoadMappingSheet
          open={loading}
          current={mapping.data}
          onClose={() => setLoading(false)}
          onLoaded={(text) => {
            setLoading(false);
            setAnnouncement((a) => ({ text, seq: a.seq + 1 }));
          }}
        />
      ) : null}
    </section>
  );
}
