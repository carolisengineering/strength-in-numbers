import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { saveBlob } from "../../account/saveBlob";
import { useCatalog } from "../../catalog/useCatalog";
import {
  CHANGE_MARKERS,
  CHOOSE_MARKERS,
  DOWNLOAD_FAILED,
  DOWNLOAD_FILE,
  MAPPING_OFFLINE,
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
import { MAPPING_FILENAME, mappingCsvBlob } from "./downloadMapping";
import { LoadMappingSheet } from "./LoadMappingSheet";
import { PlaceholderSheet } from "./PlaceholderSheet";
import { useHevyMapping } from "./useHevyMapping";
import styles from "./MappingCard.module.css";


/**
 * Spec 20.0 AC17, §5.1: the "Exercise pairings" card on the Hevy screen. Counts the exercise pairings, names the
 * section markers, and leads to loading a file, downloading it and reviewing the pairings. Loading needs the key
 * (it reads Hevy's exercise list); the rest needs only the server.
 */
export function MappingCard() {
  const mapping = useHevyMapping();
  const { hasKey } = useHevyKey();
  const { state: catalog } = useCatalog();
  const [loading, setLoading] = useState(false);
  const [choosingMarkers, setChoosingMarkers] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (announcement.seq > 0) statusRef.current?.focus();
  }, [announcement.seq]);
  const announce = (text: string) => setAnnouncement((a) => ({ text, seq: a.seq + 1 }));

  /** AC23: always the stored mapping as it is now (a fresh read), never a cached one. */
  async function download() {
    setDownloading(true);
    const fresh = await mapping.refetch();
    setDownloading(false);
    // A failed re-read keeps the old `data` in TanStack v5, so the status decides, never `data`.
    if (fresh.isError || fresh.data === undefined) {
      const offline = fresh.error instanceof ApiError && fresh.error.isNetworkError;
      if (!offline) reportError(fresh.error ?? new Error("mapping download failed"), { source: "hevy", op: "file" });
      return announce(offline ? MAPPING_OFFLINE : DOWNLOAD_FAILED);
    }
    const names = new Map<string, string>(catalog.rows.map((row) => [row.id, row.name]));
    saveBlob(mappingCsvBlob(fresh.data, (id) => names.get(id) ?? null), MAPPING_FILENAME);
  }

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
            <div className={styles.markers}>
              <p className={styles.muted}>{markersLine(markers)}</p>
              {/* Minor 183: with one marker set, the other must still be settable here, not only by file. */}
              <Button variant="secondary" onClick={() => setChoosingMarkers(true)}>
                {CHANGE_MARKERS}
              </Button>
            </div>
          ) : (
            <div className={styles.markers}>
              <p className={styles.muted}>{NO_MARKERS}</p>
              <Button variant="secondary" onClick={() => setChoosingMarkers(true)}>
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
        <Button variant="secondary" busy={downloading} disabled={!mapping.isSuccess || downloading} onClick={() => void download()}>
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
      {/* Mounted only while open: it reads Hevy's template list, which no other part of the card needs. */}
      {choosingMarkers ? <PlaceholderSheet open onClose={() => setChoosingMarkers(false)} /> : null}
      {mapping.data ? (
        <LoadMappingSheet
          open={loading}
          current={mapping.data}
          onClose={() => setLoading(false)}
          onLoaded={(text) => {
            setLoading(false);
            announce(text);
          }}
        />
      ) : null}
    </section>
  );
}
