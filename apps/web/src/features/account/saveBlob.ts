/**
 * Spec 12 §6.3 / AC8 — hand bytes the app already holds to the browser as a download: an object URL,
 * a hidden `<a download>` click, then the URL is revoked in a later task so the browser has started
 * reading it. Pure DOM plumbing: no navigation, no window, no storage, no parsing of the Blob. A throw
 * (a blocked click) propagates to the caller; the anchor is still removed and the URL still revoked.
 */
const REVOKE_DELAY_MS = 1000;

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
