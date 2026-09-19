# Backlog — deferred non-security fixes / known issues

Deferred, non-security work: known issues, rough edges, and follow-ups that were
consciously not fixed when they were found. Security items live in
`docs/security-backlog.md` (SB-*) instead.

Each entry records what is wrong, why it was deferred, and what "done" looks
like, so a future session can pick it up without re-deriving the analysis.
Numbering is append-only — never renumber an existing BL.

| ID | Area | Summary | Severity | Found |
|----|------|---------|----------|-------|
| [BL-1](#bl-1) | Catalog sync | **Resolved (Spec 03.3)** — a newly created/forked row could be permanently skipped by an `updated_since` delta | Medium | 2026-09-17 |
| [BL-2](#bl-2) | Catalog writes | `updateExercise`'s zero-row fallback reports a misleading 409 on an invariant break | Minor | 2026-09-17 |
| [BL-3](#bl-3) | Catalog writes | `PATCH` on a retired global row says "use fork", but fork then rejects it as retired | Minor | 2026-09-17 |
| [BL-4](#bl-4) | Testing | Route-level (`inject`) coverage thinner than repository-level for several 03.2 error cases | Minor | 2026-09-17 |
| [BL-5](#bl-5) | Observability | Routine 4xx on catalog writes log at `error` severity | Minor | 2026-09-17 |
| [BL-6](#bl-6) | API contract | `openapi.json` documents only success responses, not the 4xx matrix D19 designed | Minor | 2026-09-17 |
| [BL-7](#bl-7) | API contract | `@fastify/swagger` forces `requestBody.required: true`, misdescribing the optional `/fork` overlay | Minor | 2026-09-17 |
| [BL-8](#bl-8) | Infra / catalog sync | No `idle_in_transaction_session_timeout` on the app DB role, so a leaked idle-in-transaction session can pin the sync-token horizon | Minor | 2026-09-19 |

---

## BL-1

**A newly created or forked exercise can be permanently skipped by a delta pull.**

**Status: Resolved (2026-09-19)** by [Spec 03.3](specs/03.3-catalog-sync-token.md):
the timestamp cursor was replaced by a commit-ordered sync token (a
trigger-stamped `exercise.change_xid` plus a `syncToken` taken from
`pg_snapshot_xmin(pg_current_snapshot())` in the same statement as the rows),
which cannot skip a row by construction; the #23 interleaving below is now a
permanent regression test (Spec 03.3 AC5). Implementation PR: link pending. The
analysis below is kept as history — it describes the pre-03.3
`updated_since` / `serverTime` design, which no longer exists.

`insertWithCap` (`apps/api/src/repositories/exercise.prisma.ts`) stamps
`created_at`/`updated_at` with `now()`, which in Postgres is
`transaction_timestamp()` — fixed at `BEGIN`, therefore *before* the
`pg_advisory_xact_lock` wait and before commit. Meanwhile `findCatalogDelta`
advances the client's `serverTime` cursor to `MAX(updated_at)` over the rows the
caller can already see.

Concrete same-caller sequence:

1. Tab A fires `POST /v1/exercises`. Its transaction begins at T=0, so the new
   row is stamped `updated_at = 0`, then blocks on the advisory lock behind
   another in-flight create.
2. Tab B fires `PATCH /v1/exercises/{other}` at T=60; it takes no advisory lock,
   so it commits freely at T=70 with `updated_at = 60`.
3. A delta pull at T=120 sees the PATCH and returns cursor `60`.
4. Tab A's insert finally commits at T=150, still carrying `updated_at = 0`.
5. The next delta (`WHERE updated_at > 60`) never returns it. The client
   silently misses its own new exercise until a full re-pull.

Spec 03.2 §6 / D17 argues this is safe because "a row's app-stamped `updated_at`
can never be seen by a reader before the writing transaction commits". That is
true but insufficient: the cursor can advance past a still-uncommitted row's
timestamp via a *different*, already-visible row. Because `PATCH` and `DELETE`
take no advisory lock, they can commit inside a create's lock-wait window, which
makes the window materially wider than plain network latency.

**Why deferred:** found by code review after Spec 03.2 was otherwise complete and
verified. Switching `now()` to `clock_timestamp()` narrows the window but does
not close it, so this is a design fix to how the cursor is derived, not a
one-line patch — it belongs with the sync work rather than bolted onto 03.2.

**Done looks like:** the emitted `serverTime` cursor is clamped behind the oldest
in-flight write (or derived from commit order rather than statement/transaction
time), with a test that fails against the current implementation — i.e. one that
holds a create's transaction open past a concurrent commit and proves the created
row still arrives in a subsequent delta. Update DESIGN.md §6 and Spec 03.1's
cursor description alongside the fix, and revisit D17's reasoning, which is
currently stated too strongly.

## BL-2

**`updateExercise`'s zero-row fallback reports a misleading 409.**

In `updateExercise` (`apps/api/src/repositories/exercise.prisma.ts`), when the
gated `UPDATE` affects zero rows, the code re-reads the row and — if it is still
active — throws `ExerciseImmutableUseForkError` (409, "this is a global row, use
fork"). Ownership cannot change under a caller, so this branch is unreachable in
practice. If it ever does fire, it means a genuine invariant break, and a 409
telling the client to fork papers over it.

**Done looks like:** that branch throws `InternalError` instead, so a real
invariant break surfaces as one rather than as routine client-facing advice.

## BL-3

**`PATCH` on a retired global row sends the client to an endpoint that will refuse it.**

`PATCH /v1/exercises/{id}` on a global row returns 409
`exercise-immutable-use-fork` unconditionally, including when that global row is
retired (`is_active = false`). Following that advice, `POST
/v1/exercises/{id}/fork` then returns 409 `exercise-retired`. Spec 03.2 §6
specifies the unconditional "global → use fork" mapping, so the current behavior
is conformant — it is just a small dead end for the client.

**Done looks like:** either `PATCH` checks retired-ness before global-ness for
this case and returns `exercise-retired` directly, or the spec explicitly notes
the two-step outcome as intended. Needs a spec decision first, since it changes
documented behavior.

## BL-4

**Route-level test coverage is thinner than repository-level for several 03.2 cases.**

Spec 03.2 §10 describes these acceptance criteria in terms of `fastify.inject`,
but several are currently proven only at the repository layer: `PATCH` → 409
`exercise-retired` (AC5), `PATCH` merged-invalid → 422 (AC4), fork-on-retired →
409 (AC7), fork overlay merged-invalid → 422 (AC6), and `PATCH`/fork/`DELETE` on
another user's row → 404 (AC8, which asks specifically for indistinguishability
at the API boundary). Invalid-token 401 is asserted only for `POST /v1/exercises`
though AC11 covers all four routes.

The behavior is genuinely verified — the gap is that a wiring mistake in the
route layer (wrong error surfaced, wrong status mapped) would not be caught.

**Done looks like:** one `inject` test per case above, in
`apps/api/test/unit/routes-exercises-writes.test.ts`.

## BL-5

**Routine 4xx on the catalog write endpoints log at `error` severity.**

`exercise-limit-reached`, `exercise-retired`, `exercise-immutable-use-fork` and
friends have no dedicated log line, so they fall to the generic
`request.log.error({ err }, "request error")` handler. Every ordinary
404/409/422 on these endpoints is therefore an `error`-level log entry.

This is pre-existing Spec 01 behavior rather than something 03.2 introduced, but
the write endpoints will produce enough routine rejections to make it noticeable
on Render, and it distorts error-rate alerting.

**Done looks like:** expected `AppError` subclasses (4xx) log at `info`/`warn`,
with `error` reserved for 5xx and genuinely unexpected throws. Spec 03.2 §9's
rejection counters can hang off the same change.

## BL-6

**`openapi.json` documents only success responses for the catalog write operations.**

The four new operations declare `201`/`200`/`204` only. The 403/409/422 matrix
that decision D19 went to real trouble to design is invisible in the published
contract. This matches the existing `/v1/me` convention and Spec 03.2 AC11 only
requires the paths to appear, so it is not a regression — but the contract
under-describes the API for any client generated from it.

**Done looks like:** a shared problem+json response component referenced by the
4xx responses each operation can actually return, applied consistently across
`/v1/me` and the catalog routes rather than only the new ones.

## BL-7

**The published contract says the `/fork` overlay body is required, when it isn't.**

`POST /v1/exercises/{id}/fork` accepts a request with no body at all (the overlay
is optional per Spec 03.2 §5, and this is verified by a route test). The route
schema documents that correctly — `anyOf: [<object>, null]` with `default: {}`.

But `@fastify/swagger` (9.8.1) hardcodes `requestBody.required: true` in the
emitted document whenever `schema.body` is defined at all, regardless of the
schema's own nullability; the library's source comments confirm this is
deliberate on their side. So `openapi.json` misdescribes the endpoint: a client
generated from the contract will believe a body is mandatory when the server
happily accepts none.

Runtime behavior is correct — this is a documentation-fidelity bug only.

**Done looks like:** either a post-emit transform in
`apps/api/scripts/emit-openapi.ts` that clears `requestBody.required` for
operations whose body schema is nullable, or an upstream fix / version bump that
respects schema nullability. Whichever path, the CI drift check must still pass
deterministically.

## BL-8

**No `idle_in_transaction_session_timeout` on the app DB role, so a leaked session can pin the sync horizon.**

The catalog sync token (Spec 03.3) is `pg_snapshot_xmin(pg_current_snapshot())`,
which is held back by any transaction that has performed a write and not yet
ended. A session that wrote and then leaked "idle in transaction" (a bug, a
crashed handler that never released its connection) would keep the horizon
pinned indefinitely, so every delta would re-send all rows stamped at or above
it. This is extra payload, **never a correctness gap** (Spec 03.3 §6.6) — which
is why it was not shipped with the fix.

**Why deferred:** independent infrastructure hardening with no schema or code
dependency on migration `0004`; Spec 03.3 §6.6 / §8 recommended it as a small
separate change. Legitimate long transactions (the catalog seed's 60 s
transaction) widen the re-send window regardless of this setting, so it bounds
only the leaked-session variant.

**Done looks like:** `ALTER ROLE <app role> SET idle_in_transaction_session_timeout
= '30s'` (or a similar bound) applied to the Neon connection role and recorded in
`docs/runbooks/first-deploy.md` (and in the Spec 15 AWS/RDS provisioning). Before
applying, confirm the catalog seed — a multi-statement, Node-driven transaction
run under `DATABASE_URL` — never sits idle between statements for longer than the
bound, or run it under a role that is exempt.
