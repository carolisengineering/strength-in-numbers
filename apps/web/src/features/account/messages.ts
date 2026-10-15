import { ACCOUNT_PURGE_GRACE_DAYS } from "@sin/core";

/** Spec 12 AC16: how long "Delete my account" stays inert after step 2 appears. */
export const STEP_SETTLE_MS = 700;
export const EXPORT_FALLBACK_FILENAME = "strength-in-numbers-export.json";
/** O1 (open): replace with a real address/link when the owner supplies one; AccountDeleted.tsx reads it too. */
export const CONTACT_OWNER = "contact the app owner";

export const MESSAGES = {
  dataTitle: "Your data",
  dataBody: "A file with your profile, custom exercises, routines and every workout, including sets and notes.",
  download: "Download my data",
  downloadFirst: "Download my data first",
  preparing: "Preparing your data…",
  downloadAgain: "Download again",
  saved: (filename: string) => `Saved ${filename}`,
  tryAgain: "Try again",
  offline: "You're offline. Connect and try again.",
  exportFailed: "Couldn't prepare your data.",
  tooManyDownloads: "Too many downloads.",
  tooManyAttempts: "Too many attempts.",
  deleteFailed: "Couldn't delete your account.",
  deleteTitle: "Delete account",
  deleteBody: "Lock your account and schedule your data for erasure.",
  deleteTrigger: "Delete account…",
  step1Title: "Delete your account?",
  step1Body: `Your account locks right away on every device. Your data is permanently erased at least ${ACCOUNT_PURGE_GRACE_DAYS} days later. You can't undo this yourself, and you can't download your data after you continue.`,
  step1Backups: "Backups age out on the hosting provider's schedule.",
  step1Continue: "Continue",
  step2Title: "Are you sure?",
  step2Body: "Your account will be locked right away. This can't be undone from the app.",
  step2Confirm: "Delete my account",
  deletedTitle: "Your account is scheduled for deletion",
  deletedLocked: (date: string) => `Your account is locked. Your data won't be erased before ${date}.`,
  deletedRestore: `To restore your account before then, ${CONTACT_OWNER}.`,
  signOut: "Sign out",
} as const;
