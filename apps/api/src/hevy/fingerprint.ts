import { createHash } from "node:crypto";
import { HEVY_FINGERPRINT_VERSION } from "@sin/core";

/**
 * Spec 19.0 §6.5: the stored "what was sent" fingerprint, `v1:` + SHA-256 hex of `@sin/core` `hevyFingerprintSource`.
 * Server-side only: the client cannot make a stale copy look current (D6).
 */
export function hevyFingerprint(source: string): string {
  return `${HEVY_FINGERPRINT_VERSION}:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

/** The version tag of a stored fingerprint (the text before the colon); another version reads `sent` (AC26). */
export function fingerprintVersion(fingerprint: string): string {
  return fingerprint.split(":", 1)[0]!;
}
