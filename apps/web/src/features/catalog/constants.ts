/** How long a successful refresh counts as fresh (Spec 06.0 §8, AC14). */
export const CATALOG_REFRESH_STALE_MS = 5 * 60 * 1000;

/** The recents cap (Spec 06.0 §8, AC21). */
export const MAX_RECENTS = 10;

/** Versioned, per-user storage keys (Spec 06.0 §4, AC9). */
export const catalogKey = (userId: string): string => `sin:catalog:v1:${userId}`;
export const recentsKey = (userId: string): string => `sin:recents:v1:${userId}`;
