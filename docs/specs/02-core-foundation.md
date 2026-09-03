# Spec 02 — `packages/core` Foundation

**Status:** Draft v0.2 — architect review applied (2026-09-02)
**Last updated:** 2026-09-02
**Design refs:** DESIGN.md §3.4 (`packages/core` purity rules), §4.0–4.5 (conventions, enums, entities), §4.8 (unit handling / generated columns), §6 (API contract / JSON casing), §8.2–8.3 (security, testing)

---

## 1. Purpose, scope & non-goals

Turn the `@sin/core` stub shipped by Spec 01 into the real shared domain
foundation: the primitives (enums, branded ids), the DTO + validation pattern,
units conversion, a hardened purity check, and an in-package test setup. Every
later spec — API and web — imports its shared vocabulary from here.

This spec is **foundation only**. It deliberately does *not* contain the domain
math or the API-contract codegen; both have owners elsewhere and both would push
this past one work session.

> **First-principles note (for a backend dev newer to the JS ecosystem):**
> `packages/core` is a *workspace package* — a folder with its own
> `package.json` that the API and the web app depend on by name (`@sin/core`)
> instead of by relative path. pnpm symlinks it into each consumer's
> `node_modules`. There is no publish to npm; "shipping" it just means merging it
> so the next `pnpm -r build` picks it up. The value of a shared package is a
> *single implementation* of rules that both the server and the browser (and a
> future React Native app) must agree on — unit conversion being the textbook
> case.

### In scope

- **Package build.** ESM-only output with type declarations, a correct `exports`
  map (`import` + `types` conditions), `sideEffects: false`, `tsconfig` tuned for
  a library (declaration output, `isolatedModules`). Consumable unchanged by a
  React Native bundle (DESIGN §3.4).
- **In-package tests.** Wire Vitest into `@sin/core` (today `test` only runs the
  purity script). Add it to the CI unit job.
- **Zod** added as the sole runtime dependency; the DTO-type + Zod-schema
  authoring pattern, with one worked pair (`Me` / `UpdateMeInput`) mirroring
  Spec 01's `GET`/`PATCH /v1/me` **exactly**, including its `camelCase` field
  names (DESIGN §6).
- **Shared primitives.** `UnitPreference`, `WeightUnit`, `DistanceUnit`,
  `Modality`, `SetType`, `RecordType` — each exported as both a TS type and a
  runtime value array, matching DESIGN §4.0–4.5 exactly. A branded-id
  *mechanism* + helper, plus `UserId` as the first (and, in this spec, only)
  concrete brand; later specs add their own brands through the helper.
- **Units module.** `toCanonicalKg(value, unit)` / `toCanonicalMeters(value,
  unit)` and their inverses, with the exact factors that DESIGN §4.8 requires the
  Spec 05 `weight_kg` / `distance_m` generated columns to reuse.
- **Purity check hardening.** Keep the dependency-free script from Spec 01, run
  it as a real `test:unit` alongside Vitest, add a fixture test that proves it
  fails on a forbidden import / global, and assert the runtime-dependency
  allowlist (`zod` only).
- **Docs.** Confirm `specs/README.md` row 02 = Draft; confirm DESIGN §6's
  codegen note is present; apply the DESIGN edits this spec drives (distance
  units + factors in §4.0/§4.8, JSON casing convention in §6).

### Non-goals

- **Domain math** — estimated-1RM, volume, PR-detection rules. Added to `core` by
  the specs that first use it (Spec 05 logging, Spec 07 progress), per
  `specs/README.md` ownership. Spec 02 only lays the foundation they build on.
- **Display rounding / formatting helpers** (`formatWeight`, etc.). No consumer
  until a rendering spec (04/06/08); the first such spec owns its display rule.
  `core` ships conversion only. (§12.)
- **OpenAPI 3.1 emit + `openapi-typescript` codegen + a CI drift check.** No
  OpenAPI document exists yet (Spec 01's endpoints are hand-built). Deferred to
  **Spec 03.0**, which resolved to *emit, no codegen* (§12 update). Spec 02's
  `Me*` Zod schemas became the authoring source, not a generator target. (§12.)
- **The authed API client / fetch wrapper.** Spec 04.
- **Modality → required-measure validation.** The `Modality` enum lives here; the
  validator itself is Spec 05 (DESIGN §4.4).
- **React hooks / stores / any DOM code.** Spec 04+. The purity check forbids it
  landing here by accident.

---

## 2. Acceptance criteria

Behavioural criteria (AC4–AC9) each get ≥1 Vitest test naming their number
(`describe("AC6 — …")`). AC1–AC3, AC10, AC11 are pipeline/infra criteria verified
by CI and review — see §10 for the method against each.

1. **Builds as a library.** `pnpm --filter @sin/core build` emits `dist/` with
   `.js` + `.d.ts`; `pnpm -r build` stays green; the post-build
   `scripts/check-exports.mjs` loads the `exports`-map `import` target and asserts
   the whole §3 surface is exported, and that the `types` target exists and is
   non-empty. Full consumer-side resolution (Node conditions + `bundler`
   moduleResolution) is exercised for real when `apps/web` imports `@sin/core`
   in Spec 04.
2. **Purity check is a first-class test.** `pnpm --filter @sin/core test:unit`
   runs both Vitest and the purity script; CI runs the same. The script fails on
   a React / `react-native` / DOM-global / Node-builtin import and on a forbidden
   global (`window`, `document`, `process.env`, …); it passes on the shipped
   `src/`.
3. **Runtime-dependency allowlist.** `zod` is the only entry in `dependencies`. A
   Vitest test reads `package.json` and fails if `Object.keys(dependencies)`
   is anything other than `["zod"]`.
4. **Shared enums match the design.** `UnitPreference`, `WeightUnit`,
   `DistanceUnit`, `Modality`, `SetType`, `RecordType` are each exported as a TS
   union type *and* a frozen runtime array; a test asserts each array's members
   equal the values in DESIGN §4.0–4.5 — `UnitPreference`/`WeightUnit` = `kg|lb`,
   `DistanceUnit` = `m|km|mi`, `SetType` = `warmup|working|drop|failure`,
   `RecordType` = `heaviest_weight|best_est_1rm|best_set_volume`, `Modality` per
   §4.2.
5. **Branded ids.** `UserId` is not assignable from a plain `string`;
   `parseUserId(s)` validates the id shape (§6) and returns the branded type,
   throwing on a malformed input; `isUserId` is the guard. Verified by an
   `expectTypeOf` negative assertion under `vitest --typecheck` plus a runtime
   test for `parseUserId` accept/throw. The branding helper is exercised by
   defining a throwaway second brand in the test.
6. **Weight → canonical kg matches the DB.** `toCanonicalKg(v, "lb")` uses the
   factor `0.45359237` and equals `v * 0.45359237` for a table of cases;
   `toCanonicalKg(v, "kg")` is identity; `kgToLb(lbToKg(x))` round-trips within
   `1e-9`. The formula is the one DESIGN §4.8 requires the `set_entry.weight_kg`
   generated column (Spec 05) to reuse.
7. **Distance → canonical metres.** `toCanonicalMeters(v, unit)` handles
   `m | km | mi` with `km` = `v * 1000` and `mi` = `v * 1609.344`; identity for
   `m`. These are the constants DESIGN §4.8 requires the `set_entry.distance_m`
   generated column (Spec 05) to reuse. Exported as named constants
   (`LB_TO_KG`, `MI_TO_M`, `KM_TO_M`) so Spec 05 imports rather than re-types
   them.
8. **Conversion never rounds.** The conversion functions return full-precision
   `number`s; there is no rounding, clamping, or formatting inside `core`. A test
   asserts `toCanonicalKg(1, "lb") === 0.45359237` exactly (no pre-rounded
   result).
9. **DTO + schema pattern.** `MeSchema` / `UpdateMeSchema` (Zod) and the inferred
   `Me` / `UpdateMeInput` types are exported, with `camelCase` fields matching
   Spec 01 §5 (`id`, `email`, `displayName`, `unitPreference`, `timezone`,
   `createdAt`; `isNewUser` — see §6). `MeSchema.parse` accepts a valid Spec 01
   `GET /v1/me` body; `UpdateMeSchema` is `.strict()`, accepts
   `{ displayName?, unitPreference?, timezone? }`, and rejects an unknown
   `unitPreference` value and any unknown top-level key.
10. **Entrypoints unchanged for callers.** `pnpm run core:purity` and
    `pnpm run typecheck` (root) still work; `dist/` is git-ignored, not
    committed.
11. **Docs consistent.** `specs/README.md` row 02 status = Draft (already set);
    DESIGN §6 codegen note present (already set); DESIGN §4.0/§4.8 carry the
    distance units + factors and DESIGN §6 the JSON-casing line (this spec's
    edits).

---

## 3. Dependencies & exposed interface

### Needs

- **Spec 01** — the monorepo, the CI unit/purity jobs, TS 5.7 baseline, and the
  `/v1/me` contract (`01-foundation-auth.md` §5) that the `Me` DTO mirrors
  verbatim.
- Node 22, pnpm workspaces.
- New: `zod` (runtime), `vitest` already present at the workspace root but added
  to `@sin/core` dev deps with `--typecheck` enabled.

### Provides — stable surface (changes here are breaking for every consumer)

| Export | Shape | Consumed by |
|---|---|---|
| `UNIT_PREFERENCE_VALUES` / `UnitPreference`, and the same pair for `WeightUnit`, `DistanceUnit`, `Modality`, `SetType`, `RecordType` | `readonly` value array + union type | 03, 05, 06, 07 |
| `brandId<Name>()` helper + `UserId`, `parseUserId`, `isUserId` | branding mechanism + first concrete brand | every later spec adds its own id brand via the helper (`ExerciseId` in 03; `WorkoutId`, `WorkoutExerciseId`, `SetEntryId` in 05; `PersonalRecordId` in 07) |
| `toCanonicalKg`, `toCanonicalMeters`, `kgToLb`, `lbToKg`, `mToKm`, `kmToM`, `mToMi`, `miToM`; constants `LB_TO_KG`, `KM_TO_M`, `MI_TO_M` | pure `number → number` | 05 (generated-column constants), 07 (aggregates) |
| `Me`, `UpdateMeInput`, `MeSchema`, `UpdateMeSchema` | DTO types + Zod schemas; the pattern later DTOs copy | 03+ (as a template), 04 (client types) |

Explicitly **not** part of the stable surface: `CORE_PACKAGE_VERSION` is dropped
(it duplicated `package.json`); any formatting/rounding helper (out of scope).

Single entrypoint `@sin/core` — no subpath exports yet (§12).

---

## 4. Data model

N/A — a library; owns no tables and runs no migrations. It **defines** two
unit contracts that Spec 05's schema must adopt unchanged:

- the `kg` canonical factor `LB_TO_KG = 0.45359237` for `set_entry.weight_kg`;
- the `m` canonical factors `KM_TO_M = 1000`, `MI_TO_M = 1609.344` for
  `set_entry.distance_m`.

DESIGN §4.8 now records this direction of dependency (core defines, the generated
columns reuse). Drift between them produces silently wrong PRs and charts
(Risk R4), so AC6/AC7 pin the factors with explicit tables.

---

## 5. Module surface

*(Library spec — replaces "API surface".)*

```ts
// enums.ts
export const UNIT_PREFERENCE_VALUES = ["kg", "lb"] as const;
export type UnitPreference = (typeof UNIT_PREFERENCE_VALUES)[number];
export const WEIGHT_UNIT_VALUES   = ["kg", "lb"] as const;         // input unit of a set
export const DISTANCE_UNIT_VALUES = ["m", "km", "mi"] as const;
export const SET_TYPE_VALUES      = ["warmup", "working", "drop", "failure"] as const;
export const RECORD_TYPE_VALUES   = ["heaviest_weight", "best_est_1rm", "best_set_volume"] as const;
export const MODALITY_VALUES      = [/* per DESIGN §4.2 */] as const;
// …each with its `type X = (typeof X_VALUES)[number]`.

// ids.ts — branding mechanism + first brand
type Brand<T, N extends string> = T & { readonly __brand: N };
export function brandId<N extends string>(name: N): {
  schema: z.ZodType<Brand<string, N>>;
  parse: (s: string) => Brand<string, N>;
  is: (s: string) => s is Brand<string, N>;
};
export type UserId = Brand<string, "UserId">;
export const { parse: parseUserId, is: isUserId } = brandId("UserId");

// units.ts
export const LB_TO_KG = 0.45359237;
export const KM_TO_M = 1000;
export const MI_TO_M = 1609.344;
export function toCanonicalKg(value: number, unit: WeightUnit): number;   // kg identity; lb × LB_TO_KG
export function toCanonicalMeters(value: number, unit: DistanceUnit): number;
export function kgToLb(kg: number): number;   // + lbToKg, mToKm, kmToM, mToMi, miToM
// No rounding, clamping, or formatting anywhere in this module.

// dto/me.ts — the pattern later DTOs copy
export const MeSchema = z.object({
  id: UserIdSchema,
  email: z.string().email(),
  displayName: z.string().max(80).nullable(),
  unitPreference: z.enum(UNIT_PREFERENCE_VALUES),
  timezone: z.string().min(1),
  createdAt: z.string().datetime(),
  isNewUser: z.boolean().optional(),          // present only on the provisioning response (Spec 01 §5)
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeSchema = z.object({
  displayName: z.string().max(80).nullable().optional(),
  unitPreference: z.enum(UNIT_PREFERENCE_VALUES).optional(),
  timezone: z.string().min(1).optional(),
}).strict();
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
```

`isNewUser` is modelled as an optional field on `MeSchema` (not a separate
envelope type) because Spec 01 returns it inline on the create path and omits it
elsewhere; consumers treat `undefined`/`false` identically.

---

## 6. Behavior & logic

### Conversion (exact, must match the DB)

- `toCanonicalKg(v, "kg") === v`; `toCanonicalKg(v, "lb") === v * 0.45359237`.
- `toCanonicalMeters(v, "m") === v`; `"km"` → `v * 1000`; `"mi"` → `v * 1609.344`.
- Inverse helpers divide by the same constant.
- **No rounding anywhere in `core`.** DESIGN §4.8: stored `weight` / `weight_kg`
  keep full precision; rounding is a *display* concern and belongs to whichever
  spec renders the number. This is why the formatting helpers are out of scope
  (§1, §12).

### Enum value-arrays alongside the types — why both

A TS `type` vanishes at compile time. The web app needs the actual list of
`UnitPreference` values to render a `<select>`, and Zod needs it to build
`z.enum(...)`. Exporting `UNIT_PREFERENCE_VALUES` once and deriving both the type
and the schema from it keeps a single source of truth.

### `WeightUnit` vs `UnitPreference`

Structurally identical today (`kg | lb`) but kept as distinct nominal types:
`WeightUnit` is *the unit a specific set was entered in* (stored on
`set_entry`), `UnitPreference` is *the user's display default* (stored on
`user`). They can diverge in future (e.g. a `stone` display option) and
consumers should not treat one as the other.

### Branded ids — what, why, and how consumers extend it

`type UserId = string & { readonly __brand: "UserId" }` is a compile-time-only
tag: at runtime it is a plain string, but TypeScript refuses to pass a raw
`string` (or a `WorkoutId`) where a `UserId` is expected until it goes through
`parseUserId`. It costs nothing at runtime and catches "passed the wrong id"
bugs, which are common once several id-typed params sit together.

Spec 02 ships the **mechanism** (`brandId(name)` → `{ schema, parse, is }`) and
the single brand `UserId`. Every later spec adds its own the same way — e.g.
Spec 03.1: `export const { parse: parseExerciseId } = brandId("ExerciseId")` — so
the id vocabulary grows without this spec enumerating types it can't yet define.

### Id shape validation

`parseUserId` uses `z.string().uuid()` — it accepts any RFC-4122 UUID, **not**
strictly v7. Rationale: ids are minted app-side by the `uuidv7` package (Spec 01
Q5), test fixtures and seed data legitimately use v4, and the version nibble
carries no authorization meaning. If a strict-v7 guard is ever wanted it is an
additive `.regex(...)` on the shared schema, one place.

---

## 7. Security & privacy

- No data at rest, no secrets, no network, no auth. The only failure mode with
  user impact is a **wrong conversion factor** → incorrect stored-set echoes /
  PRs / charts (Risk R4), mitigated by the exact-value test tables in AC6–AC8
  and by DESIGN §4.8 now naming `core` as the single definition the DB columns
  reuse.
- The **purity check is a security-adjacent control**: it stops `packages/core`
  from quietly importing Node `crypto`/`fs` or a DOM global, which would both
  break the RN seam (R2) and widen the trusted surface of code that runs in the
  browser.
- Zod as the sole runtime dep keeps the dependency-supply-chain surface of
  browser-shipped code minimal; AC3 guards it.

---

## 8. Config & secrets

None. The package reads no environment and has no configuration.

---

## 9. Observability

None emitted — pure functions, no logging (a `console.*` call would also trip the
purity globals list). Consumers log; `core` throws typed errors (`parse*`
failures, Zod issues) for the caller to handle.

---

## 10. Testing

- **Runner:** Vitest in `packages/core` with `--typecheck` enabled, plus the
  existing dependency-free purity script. Both run under `test:unit`; CI unit job
  calls `pnpm --filter @sin/core test:unit`. Type-level tests live in
  `test/types/*.test-d.ts` with a `test/tsconfig.json` that includes them and is
  excluded from the library build.

| Criterion | Verified by |
|---|---|
| AC1 | CI `check` job runs `pnpm --filter @sin/core run build`; `scripts/check-exports.mjs` loads the `exports`-map `import` target, asserts every §3 export is present, and asserts the `types` target exists and is non-empty. Real consumer resolution lands with `apps/web` in Spec 04. |
| AC2 | Vitest fixture test (writes a temp file with a forbidden import, spawns the purity script, asserts non-zero exit) **and** the CI purity step on real `src/` |
| AC3 | Vitest test reading `package.json.dependencies` |
| AC4 | Vitest table test: each `*_VALUES` array deep-equals the DESIGN list |
| AC5 | `expectTypeOf` negative assertion (`--typecheck`) that a raw string isn't a `UserId`; runtime test for `parseUserId` accept/throw; helper exercised with a throwaway brand |
| AC6 | Vitest parametrised table `(value, unit) → expected kg`, incl. exact `0.45359237` cases + round-trip tolerance |
| AC7 | Same style for distance; assert exported constants equal `1000` / `1609.344` |
| AC8 | Vitest exact-equality assertions that conversions are unrounded |
| AC9 | `MeSchema.parse` on a valid fixture body; `UpdateMeSchema.parse` rejects unknown `unitPreference` value and unknown keys; `expectTypeOf` that `Me` fields are camelCase |
| AC10 | Review + CI: root `core:purity` / `typecheck` scripts unchanged; `.gitignore` diff shows `dist/` ignored |
| AC11 | Review of the DESIGN.md / README.md diff in the same PR |

- **Coverage:** units + schemas at/near 100% line coverage — cheap and this is
  exactly where "silent wrongness hurts most" (DESIGN §8.3). No integration or
  e2e; `test:integration` stays a no-op.
- The ≥90%-coverage gate in CLAUDE.md is for the API auth/user code, not this
  package; no change to it here.

---

## 11. Deployment & rollback

Not independently deployed. It ships by being merged; the next `apps/api` /
`apps/web` build resolves the new version through the workspace symlink. No
migration, no runtime state, no feature flag.

- **Rollback:** revert the commit. Because consumers only start importing the new
  surface in their own specs (03+), reverting Spec 02 alone has no runtime blast
  radius.
- **Versioning:** stays `0.0.0` / `private` — no npm publish in v1.

---

## 12. Decisions & open questions

### Resolved

- ✅ **Defer the OpenAPI pipeline to Spec 03.** No OpenAPI document exists yet
  (Spec 01 hand-built its endpoints). Standing up `@fastify/swagger` emit + a CI
  drift check now would push Spec 02 past one session for no consumer.
  **Update (2026-09-03):** the old "Spec 03" split into **Spec 03.0** (the
  contract pipeline), **Spec 03.1** (exercise catalog — read) and **Spec 03.2**
  (catalog — writes). The pipeline (03.0) resolved to *no codegen* — Zod DTOs in
  `@sin/core` are the authoring format and OpenAPI 3.1 is emitted **from** them
  (`fastify-type-provider-zod`), not the other way round. So `MeSchema` /
  `UpdateMeSchema` are not a "target the generator must reproduce"; they are the
  source. References below to "the Spec 03 generator" should be read as "the
  Spec 03.0 emit".
- ✅ **JSON DTOs are `camelCase`; DB columns stay `snake_case`; the DTO layer
  maps between them.** Spec 01's `/v1/me` already does this in its examples;
  pinned as a convention in DESIGN §6 so the reference `Me*` pair — and the
  Spec 03 generator — are unambiguous.
- ✅ **Units scope = weight + distance conversion only.** No formatting/rounding
  helpers in `core`; the first rendering spec (04/06/08) owns display precision.
  e1RM / volume / PR math stays with Specs 05/07 per `specs/README.md` ownership.
- ✅ **Distance canonical units + factors** (`m|km|mi`; `KM_TO_M = 1000`,
  `MI_TO_M = 1609.344`) are **defined in `core`**; Spec 05's `distance_m`
  generated column reuses the constants. Added to DESIGN §4.0/§4.8.
- ✅ **Branded ids via a shared `brandId(name)` helper built on Zod
  `.brand()`.** Zod is already the sole runtime dep; `.brand()` composes into
  `MeSchema` and yields `parse`/guard for free. Spec 02 ships the helper +
  `UserId` only; each later spec adds its own brand through the helper.
- ✅ **`parseUserId` accepts any RFC-4122 UUID, not strictly v7** — ids are
  minted app-side, fixtures use v4, the version carries no auth meaning. A strict
  guard, if ever needed, is an additive `.regex()` in one place.
- ✅ **Type-level tests use Vitest `expectTypeOf` under `--typecheck`** (no new
  dep) in `test/types/`, not `tsd` and not bare `@ts-expect-error` (which passes
  on *any* error, not just the intended one).
- ✅ **Single package entrypoint** (`@sin/core`), no subpath exports yet.
  Revisit only if the SPA bundle shows tree-shaking problems.
- ✅ **`zod` is the sole runtime dependency** (AC3). DESIGN §3.4's "size/deps
  check" is interpreted as this allowlist for now; a bundle-size assertion can be
  added later if `core` grows.
- ✅ **`Modality` enum lands here; its required-measure validator does not** —
  that's Spec 05 (DESIGN §4.4).
- ✅ **`CORE_PACKAGE_VERSION` is dropped** — it duplicated `package.json` and had
  no consumer.
- ✅ **`MeSchema` / `UpdateMeSchema` are response/echo validators, not a re-impl
  of Spec 01's server rules.** `createdAt` allows an offset (`.datetime({ offset:
  true })`), `timezone` is `.min(1)` not `Intl`-validated, and `UpdateMe`'s
  `displayName` is `.nullable()` (the column is nullable → clearing is allowed).
  The server stays the authority on writes; the Spec 03 generator is not expected
  to reproduce `Intl`-level timezone validation.

### Open

- ❓ **`test:integration` for `@sin/core`** stays a no-op (`"true"`). Fine for
  v1; revisit only if `core` ever gains I/O (it should not).
- ✅ **`MeSchema` stays hand-authored in `dto/me.ts`.** Resolved by Spec 03.0
  (2026-09-03): the pipeline *emits* OpenAPI from the Zod schemas — there is no
  generated file and no generator to match. `MeSchema` / `UpdateMeSchema` are
  the authoring source; Spec 03.0 migrates `/v1/me` onto them.
