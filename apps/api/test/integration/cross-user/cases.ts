import type { RouteKey } from "./registry.js";
import type { World } from "./world.js";

/**
 * Spec 21.0 §5 — the cross-user case table. One or more cases per non-exempt
 * `/v1` route. The runner (`cross-user-routes.integration.test.ts`) executes
 * every case; the coverage gate (`gate.ts`) fails on any route or id slot
 * nobody covered.
 */

export type Actor = "A" | "C";

export interface Req {
  method: string;
  url: string;
  body?: unknown;
}

export interface ControlReq extends Req {
  expectStatus: number;
  /** For reads: an id of A's that the response body must contain. */
  expectId?: string;
}

export interface CrossUserCase {
  route: RouteKey;
  name: string;
  /** The id slots (`idSlots` paths) this case exercises. */
  covers: string[];
  /**
   * - `foreign-id`: called twice, with B's id and with a fresh id; the answers must match (AC8).
   * - `collection`: a read whose body must hold only A's data (AC13).
   * - `collision`: A reuses one of B's keys and gets a new row of its own (AC14).
   * - `write-isolation`: a write with no foreign id; B must be unchanged (AC9).
   */
  kind: "foreign-id" | "collection" | "collision" | "write-isolation";
  /** The status pinned from spec §5 (for `foreign-id`, the answer to both calls). */
  expect: { status: number };
  actor: Actor;
  /** The request; `foreign-id` cases put `slotValue` where B's id goes. */
  call(w: World, slotValue?: string): Req;
  /** B's id for the slot (`foreign-id` only). */
  foreignId?(w: World): string;
  /** The same request on A's own data (AC11). */
  control(w: World): ControlReq;
  /** Creates the resource a destructive control consumes; runs before `control`. */
  disposable?(w: World): Promise<void>;
  /** Extra checks on the response(s), for collections and collisions. */
  check?(w: World, res: { status: number; body: string }): Promise<void> | void;
}

export const CASES: CrossUserCase[] = [];
