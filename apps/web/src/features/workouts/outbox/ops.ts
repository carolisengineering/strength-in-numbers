import { z } from "zod";
import { CreateSetSchema, UpdateSetSchema, type CreateSet, type UpdateSet } from "@sin/core";

/**
 * One queued set write (Spec 06.2 §6.1). A set the server has not acknowledged yet is named by its
 * `clientGeneratedId`; after its create syncs, the outbox's id map resolves that key to the server id.
 */
export type OpTarget = { clientGeneratedId: string } | { setId: string };

export interface OpFailure {
  status: number;
  type: string;
  requestId: string | null;
}

export interface OpBase {
  id: string;
  workoutId: string;
  workoutExerciseId: string;
  userId: string;
  status: "queued" | "sending" | "failed";
  /** Sent at least once: the server may already have applied it, so nothing is merged into it (D3). */
  attempted: boolean;
  attempts: number;
  nextAttemptAt: number;
  enqueuedAt: number;
  failure?: OpFailure;
}

export type CreateOp = OpBase & {
  kind: "create";
  target: { clientGeneratedId: string };
  body: CreateSet & { clientGeneratedId: string };
};
export type UpdateOp = OpBase & { kind: "update"; target: OpTarget; body: UpdateSet };
export type DeleteOp = OpBase & { kind: "delete"; target: OpTarget; body: null };
export type OutboxOp = CreateOp | UpdateOp | DeleteOp;

export interface IdMapEntry {
  setId: string;
  workoutId: string;
}
/** `clientGeneratedId` → the server's set id, learned when the create synced. */
export type IdMap = Readonly<Record<string, IdMapEntry>>;

const TargetSchema = z.union([z.object({ clientGeneratedId: z.string() }), z.object({ setId: z.string() })]);
const BaseShape = {
  id: z.string(),
  workoutId: z.string(),
  workoutExerciseId: z.string(),
  userId: z.string(),
  status: z.enum(["queued", "sending", "failed"]),
  attempted: z.boolean(),
  attempts: z.number().int().min(0),
  nextAttemptAt: z.number(),
  enqueuedAt: z.number(),
  failure: z.object({ status: z.number(), type: z.string(), requestId: z.string().nullable() }).optional(),
};

/** The shape of `sin:workout:outbox`; `v` lets a later spec migrate it. */
export const OutboxFileSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  ops: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        ...BaseShape,
        kind: z.literal("create"),
        target: z.object({ clientGeneratedId: z.string() }),
        body: CreateSetSchema.extend({ clientGeneratedId: z.string() }),
      }),
      z.object({ ...BaseShape, kind: z.literal("update"), target: TargetSchema, body: UpdateSetSchema }),
      z.object({ ...BaseShape, kind: z.literal("delete"), target: TargetSchema, body: z.null() }),
    ]),
  ),
  idMap: z.record(z.string(), z.object({ setId: z.string(), workoutId: z.string() })),
});

export function sameTarget(a: OpTarget, b: OpTarget): boolean {
  if ("setId" in a) return "setId" in b && a.setId === b.setId;
  return "clientGeneratedId" in b && a.clientGeneratedId === b.clientGeneratedId;
}

/** One key per set: a set created here is keyed by its client key even when an op names its server id. */
function setKeyOf(op: OutboxOp, idMap: IdMap): string {
  if ("clientGeneratedId" in op.target) return `c:${op.target.clientGeneratedId}`;
  const { setId } = op.target;
  const created = Object.entries(idMap).find(([, entry]) => entry.setId === setId);
  return created ? `c:${created[0]}` : `s:${setId}`;
}

/**
 * How many *sets* of `workoutId` are not saved yet (Spec 06.2 AC15, AC16): a set with several queued
 * ops counts once, and a set with any failed op counts as failed, not pending (code review #3).
 */
export function unsavedSets(ops: readonly OutboxOp[], workoutId: string, idMap: IdMap): { pending: number; failed: number } {
  const failed = new Set<string>();
  const all = new Set<string>();
  for (const op of ops) {
    if (op.workoutId !== workoutId) continue;
    const key = setKeyOf(op, idMap);
    all.add(key);
    if (op.status === "failed") failed.add(key);
  }
  return { pending: all.size - failed.size, failed: failed.size };
}

const replaceAt = (ops: readonly OutboxOp[], index: number, op: OutboxOp): OutboxOp[] =>
  ops.map((o, i) => (i === index ? op : o));

/**
 * A delete of a set whose create failed permanently: the server never stored it, so there is nothing
 * to delete — drop the create and every follow-up instead of queueing a delete that can never resolve
 * to a server id (code review #1). `null` when the rule does not apply.
 */
function dropNeverStoredSet(ops: readonly OutboxOp[], incoming: UpdateOp | DeleteOp): OutboxOp[] | null {
  if (incoming.kind !== "delete" || !("clientGeneratedId" in incoming.target)) return null;
  const key = incoming.target;
  const created = ops.find((o) => o.kind === "create" && sameTarget(o.target, key));
  if (!created || created.status !== "failed") return null;
  return ops.filter((o) => !sameTarget(o.target, key));
}

/**
 * An edit of a set whose create the server rejected with `422` (so nothing was stored): fold the
 * create, any follow-up edits that failed with it, and this edit into one fresh create (final review
 * I3 — merging into the last follow-up instead would leave it waiting on a create that never syncs).
 * `null` when the rule does not apply.
 */
function refoldRejectedCreate(ops: readonly OutboxOp[], incoming: UpdateOp | DeleteOp): OutboxOp[] | null {
  if (incoming.kind !== "update" || !("clientGeneratedId" in incoming.target)) return null;
  const key = incoming.target;
  const index = ops.findIndex((o) => o.kind === "create" && sameTarget(o.target, key));
  const created = ops[index];
  if (!created || created.kind !== "create" || created.status !== "failed" || created.failure?.status !== 422) return null;
  const followUps = ops.filter((o, i) => i > index && sameTarget(o.target, key));
  if (followUps.some((o) => o.kind === "delete")) return null;
  const body = followUps.reduce<CreateOp["body"]>((b, o) => (o.kind === "update" ? { ...b, ...o.body } : b), created.body);
  const fresh: CreateOp = {
    ...created,
    status: "queued",
    attempted: false,
    attempts: 0,
    nextAttemptAt: incoming.enqueuedAt,
    failure: undefined,
    body: { ...body, ...incoming.body },
  };
  return ops.filter((o) => !followUps.includes(o)).map((o) => (o === created ? fresh : o));
}

/**
 * Add `incoming` to the queue, merging it into the last op for the same set when that op was never
 * sent (Spec 06.2 §6.2, AC2, AC3). A `422`-failed op was rejected without being stored, so an edit
 * replaces it with a fresh op (AC14).
 */
export function combine(ops: readonly OutboxOp[], incoming: OutboxOp): OutboxOp[] {
  if (incoming.kind === "create") return [...ops, incoming];
  const dropped = dropNeverStoredSet(ops, incoming);
  if (dropped) return dropped;
  const refolded = refoldRejectedCreate(ops, incoming);
  if (refolded) return refolded;
  let index = -1;
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    if (sameTarget(ops[i]!.target, incoming.target)) {
      index = i;
      break;
    }
  }
  const last = index >= 0 ? ops[index]! : undefined;
  if (!last) return [...ops, incoming];

  const rejected = last.status === "failed" && last.failure?.status === 422;
  if (rejected && incoming.kind === "update" && last.kind !== "delete") {
    const reset = { status: "queued" as const, attempted: false, attempts: 0, nextAttemptAt: incoming.enqueuedAt, failure: undefined };
    return replaceAt(ops, index, { ...last, ...reset, body: { ...last.body, ...incoming.body } } as OutboxOp);
  }
  if (last.attempted || last.status !== "queued") return [...ops, incoming];

  if (last.kind === "create") {
    if (incoming.kind === "delete") return ops.filter((_, i) => i !== index);
    return replaceAt(ops, index, { ...last, body: { ...last.body, ...incoming.body } });
  }
  if (last.kind === "update") {
    if (incoming.kind === "delete") return replaceAt(ops, index, incoming);
    return replaceAt(ops, index, { ...last, body: { ...last.body, ...incoming.body } });
  }
  return [...ops, incoming];
}
