import type { HevyLinkComplete, HevyLinkState, HevyMapping, HevyMappingPatch, HevyMappingPut } from "@sin/core";

/**
 * Spec 19.0 §5–§6: the Hevy mapping and links, for one user. Every method is scoped to `userId` in SQL; a workout id
 * that is another user's, absent, malformed or deleted is `NotFoundError`. The Hevy key never reaches this layer.
 */
export interface HevyStatusRecord {
  pairCount: number;
  linkCount: number;
  recordsStale: boolean;
}

export interface HevyLinkBeginRecord {
  mode: "create" | "update";
  hevyWorkoutId: string | null;
  staleClaim: boolean;
  /** The fingerprint of the workout read in the begin transaction, also stored on the claim (Spec 19.0 D29). */
  fingerprint: string;
}

export interface HevyRepository {
  status(userId: string): Promise<HevyStatusRecord>;
  getMapping(userId: string): Promise<HevyMapping>;
  /** `PUT`: replaces the pairs and rules in one transaction; throws `ValidationError` (AC23) writing nothing. */
  replaceMapping(userId: string, input: HevyMappingPut): Promise<HevyMapping>;
  /** `PATCH`: upserts by template id and removes; same validation as replace for the upserted pairs. */
  patchMapping(userId: string, patch: HevyMappingPatch): Promise<HevyMapping>;
  readLink(userId: string, workoutId: string): Promise<HevyLinkState>;
  beginLink(userId: string, workoutId: string, opts: { relink: boolean }): Promise<HevyLinkBeginRecord>;
  completeLink(userId: string, workoutId: string, body: HevyLinkComplete): Promise<HevyLinkState>;
  releaseLink(userId: string, workoutId: string): Promise<void>;
}
