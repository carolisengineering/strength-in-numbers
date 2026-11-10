# Query audit (Spec 21.0)

Every SQL statement in `apps/api/src`, read and classified (Spec 21.0 §6.6). The rule everywhere is "you see your own
rows"; the only shared data is the reference catalog. This file is generated and checked: `apps/api/scripts/query-audit.ts`
extracts the statements from the TypeScript syntax tree, and a unit test fails when a statement is added, removed or edited
without its row changing here. After any SQL change run `pnpm --filter @sin/api run audit:queries --write`, then set the category of every row it marks
`needs review` (the test refuses that status).

Categories:

- **user-filtered**: the statement itself carries a user predicate (`user_id = $acting`, `owner_user_id IS NULL OR owner_user_id = $acting`, `id = $acting` on `"user"`, an `ownership.ts` helper, or an `INSERT` that writes the acting user's id).
- **anchored**: keyed by an id with no user predicate, but tied to an *anchor*: a user-filtered locking statement on the root row earlier in the same transaction (named in the Anchor column).
- **shared on purpose**: reference data (`muscle_group`, `equipment`, the catalog's `owner_user_id IS NULL` rows), Postgres's own catalogs (`pg_*`), or no table at all.
- **cross-user maintenance**: the operator scripts that act on many users (`account/purge.ts`, `records/rebuild.ts`, `seed/catalog.ts`).
- **fragment**: a piece composed into other statements, classified through the callers listed beside it.

## Summary

241 statements: 112 user-filtered, 54 anchored, 29 shared on purpose, 14 cross-user maintenance, 31 fragment, 1 uncategorized. **1 need review.**

### Statements that rely on an earlier check (anchored)

- `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#3` relies on `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2`: the imported workout's sections, keyed by the workout this transaction just inserted for the user
- `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#4` relies on `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2`: the imported workout's exercises, keyed by the workout this transaction just inserted for the user
- `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6` relies on `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2`: the imported sets, keyed by exercises this transaction just inserted
- `src/repositories/personal-record.prisma.ts#rootsForWorkout#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: a workout's lineage roots (exercise ids, not user data), under the finish/retime/delete workout FOR UPDATE … user_id (§6.7 #20)
- `src/repositories/personal-record.prisma.ts#rootOfWorkoutExercise#1` relies on `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1`: one exercise's lineage root, under the set write's workout lock (or the structure lock for an exercise delete) (§6.7 #20)
- `src/repositories/personal-record.prisma.ts#repeatedRootOfWorkoutExercise#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: a moved exercise's lineage root and repeat count, under the structure lock (§6.7 #20)
- `src/repositories/routine.prisma.ts#insertSections#2` relies on `src/repositories/routine.prisma.ts#create#3`: a routine's sections, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16)
- `src/repositories/routine.prisma.ts#insertItems#2` relies on `src/repositories/routine.prisma.ts#create#3`: a routine's items, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16)
- `src/repositories/routine.prisma.ts#insertItems#4` relies on `src/repositories/routine.prisma.ts#create#3`: the items' planned sets, keyed by items this transaction just inserted (§6.7 #16)
- `src/repositories/routine.prisma.ts#replace#3` relies on `src/repositories/routine.prisma.ts#replace#1`: deletes the replaced routine's items, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16)
- `src/repositories/routine.prisma.ts#replace#4` relies on `src/repositories/routine.prisma.ts#replace#1`: deletes the replaced routine's sections, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16)
- `src/repositories/set-entry.prisma.ts#assertWouldNotEmpty#1` relies on `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1`: counts the workout's sets, keyed by the workout locked for the user (the structure lock on an exercise delete) (§6.7 #6)
- `src/repositories/set-entry.prisma.ts#assertWorkingSetsComplete#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: the finish's working-set check, keyed by the workout locked FOR UPDATE … user_id (§6.7 #6)
- `src/repositories/set-entry.prisma.ts#createSet#3` relies on `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1`: locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #3)
- `src/repositories/set-entry.prisma.ts#createSet#4` relies on `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1`: the next set number of the workout exercise createSet#3 tied to the anchor
- `src/repositories/set-entry.prisma.ts#createSet#5` relies on `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1`: inserts the set into the workout exercise createSet#3 tied to the anchor
- `src/repositories/workout-retime.prisma.ts#shiftSetTimes#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: shifts set times of the workout locked FOR UPDATE … user_id (§6.7 #22)
- `src/repositories/workout-retime.prisma.ts#clampSetTimes#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: clamps set times of the workout locked FOR UPDATE … user_id (§6.7 #22)
- `src/repositories/workout-section.prisma.ts#exerciseRanks#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: the workout's exercise ranks, under the structure lock (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#lockSectionRow#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: locks the section, tied to the locked workout (workout_id = anchor; the structure lock on a timer PATCH) (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#lockSectionThenRead#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: reads the section locked by lockSectionRow#1, tied to the same workout (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#addWorkoutSection#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: counts the workout's sections, under the structure lock (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#addWorkoutSection#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: inserts a section into the workout under the structure lock (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#updateWorkoutSection#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: clears the rounds of the section lockSectionThenRead tied to the locked workout (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#updateWorkoutSection#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: updates the section, tied to the locked workout (workout_id = anchor) (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#removeWorkoutSection#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: locks the section, tied to the locked workout (workout_id = anchor) (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#removeWorkoutSection#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: counts the exercises of the section #1 tied to the anchor (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#removeWorkoutSection#3` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: deletes the section, tied to the locked workout (workout_id = anchor) (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#removeWorkoutSection#4` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: the later sections of the locked workout (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#removeWorkoutSection#5` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: renumbers one of the sections #4 read from the locked workout (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#setSectionRoundTime#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: upserts a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#clearSectionRoundTime#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: deletes a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14)
- `src/repositories/workout-section.prisma.ts#setSectionResult#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: sets the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13)
- `src/repositories/workout-section.prisma.ts#clearSectionResult#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1`: clears the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13)
- `src/repositories/workout.prisma.ts#finishedPatch#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: updates the finished workout's details, keyed by the workout locked FOR UPDATE … user_id
- `src/repositories/workout.prisma.ts#countExercises#1` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: counts a workout's exercises under the caller's workout lock (finish, delete, or the structure lock) (§6.7 #7)
- `src/repositories/workout.prisma.ts#countAndLastSection#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: the exercise count and last section of the locked workout (§6.7 #7)
- `src/repositories/workout.prisma.ts#insertFromRoutine#2` relies on `src/repositories/workout.prisma.ts#insertFromRoutine#1`: copies the routine's sections, under the routine FOR SHARE … user_id (§6.7 #11)
- `src/repositories/workout.prisma.ts#insertFromRoutine#3` relies on `src/repositories/workout.prisma.ts#insertFromRoutine#1`: reads the routine's items, under the routine FOR SHARE … user_id (§6.7 #11)
- `src/repositories/workout.prisma.ts#insertFromRoutine#5` relies on `src/repositories/workout.prisma.ts#insertFromRoutine#1`: inserts the copied exercises into the new workout (§6.7 #11)
- `src/repositories/workout.prisma.ts#insertFromRoutine#6` relies on `src/repositories/workout.prisma.ts#insertFromRoutine#1`: copies the items' planned sets, under the routine FOR SHARE … user_id (§6.7 #11)
- `src/repositories/workout.prisma.ts#insertFromRoutine#7` relies on `src/repositories/workout.prisma.ts#tryInsert#1`: stamps the routine snapshot on the workout this transaction just inserted for the user (§6.7 #11)
- `src/repositories/workout.prisma.ts#updateWorkout#2` relies on `src/repositories/workout.prisma.ts#updateWorkout#1`: updates the workout locked FOR UPDATE … user_id
- `src/repositories/workout.prisma.ts#addWorkoutExercise#1` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: shifts positions in the locked workout (§6.7 #7)
- `src/repositories/workout.prisma.ts#addWorkoutExercise#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: inserts the exercise into the locked workout (§6.7 #7)
- `src/repositories/workout.prisma.ts#updateWorkoutExercise#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8)
- `src/repositories/workout.prisma.ts#updateWorkoutExercise#3` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: the target section, tied to the locked workout (workout_id = anchor)
- `src/repositories/workout.prisma.ts#updateWorkoutExercise#4` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: shifts positions in the locked workout (§6.7 #7)
- `src/repositories/workout.prisma.ts#updateWorkoutExercise#5` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: shifts positions in the locked workout (§6.7 #7)
- `src/repositories/workout.prisma.ts#updateWorkoutExercise#6` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: updates the workout exercise #2 tied to the anchor (§6.7 #9)
- `src/repositories/workout.prisma.ts#deleteWorkoutExercise#2` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8)
- `src/repositories/workout.prisma.ts#deleteWorkoutExercise#3` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: counts the sets of the workout exercise #2 tied to the anchor (§6.7 #9)
- `src/repositories/workout.prisma.ts#deleteWorkoutExercise#4` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: deletes the workout exercise #2 tied to the anchor (§6.7 #9)
- `src/repositories/workout.prisma.ts#deleteWorkoutExercise#5` relies on `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3`: closes the position gap in the locked workout (§6.7 #7)

## src/account/purge.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/account/purge.ts#listEligible#1` | query | cross-user maintenance | ok | — | `e439e846f12a` | Reads workout, set_entry, workout_exercise, user |
| `src/account/purge.ts#classifyTarget#1` | query | cross-user maintenance | ok | — | `14fb817c5283` | Reads user |
| `src/account/purge.ts#purgeAccount#1` | query | cross-user maintenance | ok | — | `a236e9b5ff39` | Reads workout, set_entry, workout_exercise |
| `src/account/purge.ts#purgeAccount#2` | query | cross-user maintenance | ok | — | `ab3e19bdc3df` | Deletes from user |

## src/db/app-role.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db/app-role.ts#readAppRoleReport#1` | query | shared on purpose | ok | — | `e8c51e99f8d4` | Reads pg_roles: sin_app's flags (operator command, no user data) |
| `src/db/app-role.ts#readAppRoleReport#2` | query | shared on purpose | ok | — | `3fd479667ddd` | Reads pg_auth_members: sin_app's memberships (operator command, no user data) |
| `src/db/app-role.ts#setAppRoleLogin#1` | query | shared on purpose | ok | — | `c69f5425d5e5` | Reads pg_roles: does sin_app exist (operator command) |
| `src/db/app-role.ts#setAppRoleLogin#2` | query | shared on purpose | ok | — | `ce0b2d5921fc` | Transaction-local setting holding the password as a bound parameter (no table) |
| `src/db/app-role.ts#setAppRoleLogin#3` | query | shared on purpose | ok | — | `bb4f4c3144c2` | ALTER ROLE sin_app LOGIN PASSWORD from the setting (no table) |
| `src/db/app-role.ts#setAppRoleLogin#4` | query | shared on purpose | ok | — | `068abc9b2857` | Clears the transaction-local password setting (no table) |

## src/db/login-check.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db/login-check.ts#readFacts#1` | query | shared on purpose | ok | — | `bf5e8353f409` | Boot check: reads pg_roles / pg_class for the current login (no user data) |
| `src/db/login-check.ts#readFacts#2` | query | shared on purpose | ok | — | `4067e45b9d91` | Boot check: reads pg_roles / pg_class for roles the login could SET ROLE into (no user data) |
| `src/db/login-check.ts#readFacts#3` | query | shared on purpose | ok | — | `80e57d027f3e` | Boot check: reads the row_security setting (no table) |

## src/db/rls.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db/rls.ts#rlsStatus#1` | query | shared on purpose | ok | — | `85f7fd656d23` | Reads pg_class for the RLS state of the 19 tables (no user data) |
| `src/db/rls.ts#rlsTarget#1` | query | shared on purpose | ok | — | `31a9fe383ff0` | Reads the current database and login for db:rls's first output line (no table) |
| `src/db/rls.ts#setRls#1` | query | shared on purpose | ok | — | `4554a9b04ca5` | Kill switch, owner login: sets its transaction's lock timeout (no table) |
| `src/db/rls.ts#setRls#2` | query | shared on purpose | ok | — | `9b5c80c91706` | Kill switch, owner login: limits how long the lock statement can wait (no table) |
| `src/db/rls.ts#setRls#3` | query | shared on purpose | ok | — | `904ab873f1e2` | Kill switch, owner login: locks the 19 tables up front; reads no row |
| `src/db/rls.ts#setRls#4` | query | shared on purpose | ok | — | `48e4c93e6614` | Kill switch, owner login: ALTER TABLE ENABLE/DISABLE ROW LEVEL SECURITY; reads no row |

## src/db/scoped.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db/scoped.ts#setConfig#1` | query | shared on purpose | ok | — | `6bea005c738f` | Spec 21.1 handle: set_config('app.user_id') (no table) |
| `src/db/scoped.ts#setConfig#2` | query | shared on purpose | ok | — | `348c70e55865` | Spec 21.1 handle: set_config('app.auth_sub') (no table) |
| `src/db/scoped.ts#$transaction#1` | query | shared on purpose | ok | — | `6c20e5345ee8` | Spec 21.1 handle: SET TRANSACTION READ ONLY (no table) |
| `src/db/scoped.ts#$transaction#2` | query | shared on purpose | ok | — | `6c20e5345ee8` | Spec 21.1 handle: SET TRANSACTION READ ONLY, owner pass-through (no table) |

## src/db.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db.ts#checkDatabaseReady#1` | query | shared on purpose | ok | — | `e004ebd5b553` | Reads no table |

## src/records/rebuild.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/records/rebuild.ts#rebuildUserRecords#1` | query | cross-user maintenance | ok | — | `40673d3fbc52` | Reads workout, workout_exercise, exercise, personal_record |
| `src/records/rebuild.ts#rebuildRecords#1` | query | cross-user maintenance | ok | — | `d5fd1afe0553` | Reads workout, personal_record |

## src/repositories/account-export.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/account-export.prisma.ts#snapshot#1` | query | user-filtered | ok | — | `7963b119631a` | Reads hevy_exercise_pair, exercise, hevy_section_rule, hevy_link |
| `src/repositories/account-export.prisma.ts#snapshot#2` | query | user-filtered | ok | — | `dc3b4e5ace68` | Prisma user.findUniqueOrThrow |
| `src/repositories/account-export.prisma.ts#snapshot#3` | query | user-filtered | ok | — | `3b7cff4e4d00` | Reads exercise |
| `src/repositories/account-export.prisma.ts#snapshot#4` | query | user-filtered | ok | — | `0245bc5106b2` | Reads routine_item, routine_section, routine |
| `src/repositories/account-export.prisma.ts#snapshot#5` | query | user-filtered | ok | — | `ad30541bf656` | Reads workout, workout_section, workout_section_round, routine |
| `src/repositories/account-export.prisma.ts#snapshot#6` | query | user-filtered | ok | — | `f206d7f2bd07` | Reads workout_exercise, workout |
| `src/repositories/account-export.prisma.ts#snapshot#7` | query | user-filtered | ok | — | `fa15da9058a3` | Reads set_entry, workout_exercise, workout |

## src/repositories/exercise.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/exercise.prisma.ts#exerciseColumns#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#3, src/repositories/exercise.prisma.ts#loadVisibleRow#1, src/repositories/exercise.prisma.ts#insertWithCap#2, src/repositories/exercise.prisma.ts#findCatalog#1, src/repositories/exercise.prisma.ts#findCatalog#2, src/repositories/exercise.prisma.ts#updateExercise#2 | `cf686597f37d` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#lineageHasSetsSql#1` | fragment | fragment | ok | callers: src/repositories/exercise.prisma.ts#lineageHasSets#1, src/repositories/exercise.prisma.ts#updateExercise#1 | `418170a888bf` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#lineageHasSets#1` | query | user-filtered | ok | — | `0b89e7afcfae` | Reads workout_exercise, workout, set_entry, exercise |
| `src/repositories/exercise.prisma.ts#loadVisibleRow#1` | query | user-filtered | ok | — | `10eaff344e9a` | Reads exercise |
| `src/repositories/exercise.prisma.ts#validateReferences#1` | query | shared on purpose | ok | — | `56936cf979c0` | Reads muscle_group |
| `src/repositories/exercise.prisma.ts#validateReferences#2` | query | shared on purpose | ok | — | `ac4468f02872` | Reads equipment |
| `src/repositories/exercise.prisma.ts#insertWithCap#1` | query | shared on purpose | ok | — | `c13fefe5f0b4` | Takes a transaction advisory lock (no table) |
| `src/repositories/exercise.prisma.ts#insertWithCap#2` | query | user-filtered | ok | — | `9397e708cf09` | Reads exercise, _cap |
| `src/repositories/exercise.prisma.ts#findCatalog#1` | query | user-filtered | ok | — | `c72993ed42e4` | Reads snap, exercise |
| `src/repositories/exercise.prisma.ts#findCatalog#2` | query | user-filtered | ok | — | `7caf4bdd5965` | Reads snap, exercise |
| `src/repositories/exercise.prisma.ts#updateExercise#1` | fragment | fragment | ok | callers: src/repositories/exercise.prisma.ts#updateExercise#2 | `996243938463` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#updateExercise#2` | query | user-filtered | ok | — | `d7134955772a` | Updates exercise, workout_exercise, workout, set_entry |
| `src/repositories/exercise.prisma.ts#listRoutinesUsing#1` | query | user-filtered | ok | — | `c402df48e9ea` | Reads routine, routine_item |
| `src/repositories/exercise.prisma.ts#findUsage#1` | query | user-filtered | ok | — | `a5f0496c39dc` | Reads workout, workout_exercise, exercise, set_entry |
| `src/repositories/exercise.prisma.ts#deleteExercise#1` | query | user-filtered | ok | — | `447d840c0f80` | Updates exercise |
| `src/repositories/exercise.prisma.ts#listMuscleGroups#1` | query | shared on purpose | ok | — | `cb9e6396384e` | Reads muscle_group |
| `src/repositories/exercise.prisma.ts#listEquipment#1` | query | shared on purpose | ok | — | `c08d7deb0c23` | Reads equipment |

## src/repositories/hevy-import.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy-import.prisma.ts#loadContext#1` | query | user-filtered | ok | — | `ba223483e998` | Reads exercise |
| `src/repositories/hevy-import.prisma.ts#loadContext#2` | query | user-filtered | ok | — | `76d9c05ac644` | Reads user |
| `src/repositories/hevy-import.prisma.ts#findLinks#1` | query | user-filtered | ok | — | `8d293c05354f` | Reads hevy_link |
| `src/repositories/hevy-import.prisma.ts#findCandidates#1` | query | user-filtered | ok | — | `312776f9b45f` | Reads workout, workout_exercise, exercise, hevy_link |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#1` | query | user-filtered | ok | — | `1bfe70120306` | Reads exercise (FOR SHARE) |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2` | query | user-filtered | ok | — | `2898c7b5a936` | Inserts into workout |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#3` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `5cd821fdbcc2` | the imported workout's sections, keyed by the workout this transaction just inserted for the user |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#4` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `d761ca32491b` | the imported workout's exercises, keyed by the workout this transaction just inserted for the user |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#5` | fragment | fragment | ok | callers: src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6 | `e93e82bf4476` | SQL piece composed into the callers listed |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `38ca2d091080` | the imported sets, keyed by exercises this transaction just inserted |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#7` | query | user-filtered | ok | — | `badc4ca6d1f4` | Inserts into hevy_link |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#8` | query | user-filtered | ok | — | `0e2f4dad7651` | Inserts into hevy_account, SET |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#1` | query | user-filtered | ok | — | `e38a36e333e5` | Reads workout (FOR SHARE) |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#2` | query | user-filtered | ok | — | `d92c394ef51b` | Inserts into hevy_link |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#3` | query | user-filtered | ok | — | `5ff184bead2d` | After a unique violation: is this Hevy id already linked for this user? |
| `src/repositories/hevy-import.prisma.ts#finishImport#1` | query | user-filtered | ok | — | `0d01fd6dbbb7` | Reads hevy_account (FOR UPDATE) |
| `src/repositories/hevy-import.prisma.ts#finishImport#2` | query | user-filtered | ok | — | `25cd382df00a` | Updates hevy_account |

## src/repositories/hevy.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy.prisma.ts#readHevyMapping#1` | query | user-filtered | ok | — | `ea4fb433ea72` | Reads hevy_exercise_pair, exercise |
| `src/repositories/hevy.prisma.ts#readHevyMapping#2` | query | user-filtered | ok | — | `d1a1ba11c558` | Reads hevy_section_rule |
| `src/repositories/hevy.prisma.ts#lockUser#1` | query | user-filtered | ok | — | `0be4869b6a55` | Reads user (FOR NO KEY UPDATE) |
| `src/repositories/hevy.prisma.ts#visibleExercises#1` | query | user-filtered | ok | — | `a5ca983daadb` | Reads exercise |
| `src/repositories/hevy.prisma.ts#insertPairs#1` | query | user-filtered | ok | — | `19306a0e9b22` | Inserts into hevy_exercise_pair, unnest, SET |
| `src/repositories/hevy.prisma.ts#settleExportAs#1` | query | user-filtered | ok | — | `ccd4210c2f9c` | Reads hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#2` | query | user-filtered | ok | — | `c473c0bcbb6a` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#3` | query | user-filtered | ok | — | `83d660225fe5` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#4` | query | user-filtered | ok | — | `4ea634b7dadc` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#linkRow#1` | query | user-filtered | ok | — | `da55f5cd4ea3` | Reads hevy_link (FOR UPDATE) |
| `src/repositories/hevy.prisma.ts#linkRow#2` | query | user-filtered | ok | — | `2ceee69255f0` | Reads hevy_link |
| `src/repositories/hevy.prisma.ts#status#1` | query | user-filtered | ok | — | `33d61f0fd65e` | Reads hevy_exercise_pair, hevy_link, hevy_account |
| `src/repositories/hevy.prisma.ts#replaceMapping#1` | query | user-filtered | ok | — | `de502331b518` | Deletes from hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#replaceMapping#2` | query | user-filtered | ok | — | `3a2b97cccdee` | Deletes from hevy_section_rule |
| `src/repositories/hevy.prisma.ts#replaceMapping#3` | query | user-filtered | ok | — | `4918a0e4ae3b` | Inserts into hevy_section_rule, unnest |
| `src/repositories/hevy.prisma.ts#patchMapping#1` | query | user-filtered | ok | — | `fe9ccc59fc7b` | Reads hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#patchMapping#2` | query | user-filtered | ok | — | `c1a0af7fa1ba` | Deletes from hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#beginLink#1` | query | user-filtered | ok | — | `f6adb172bb63` | Reads workout (FOR UPDATE) |
| `src/repositories/hevy.prisma.ts#beginLink#2` | query | user-filtered | ok | — | `58d80bbf3eaf` | Inserts into hevy_link |
| `src/repositories/hevy.prisma.ts#beginLink#3` | query | user-filtered | ok | — | `85dee0b3a2bc` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#beginLink#4` | query | user-filtered | ok | — | `5e4ae127e8dc` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#completeLink#1` | query | user-filtered | ok | — | `458a29a8ae67` | Reads workout (FOR SHARE) |
| `src/repositories/hevy.prisma.ts#completeLink#2` | query | user-filtered | ok | — | `34a89018282c` | Reads hevy_link |
| `src/repositories/hevy.prisma.ts#completeLink#3` | query | user-filtered | ok | — | `38acfc0e59fb` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#releaseLink#1` | query | user-filtered | ok | — | `458a29a8ae67` | Reads workout (FOR SHARE) |
| `src/repositories/hevy.prisma.ts#releaseLink#2` | query | user-filtered | ok | — | `50af2951c2f9` | Deletes from hevy_link |
| `src/repositories/hevy.prisma.ts#releaseLink#3` | query | user-filtered | ok | — | `25ab3f7823df` | Updates hevy_link |

## src/repositories/ownership.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/ownership.ts#ownedWorkoutExercise#1` | fragment | fragment | ok | callers: src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1 | `a6878c1ddba7` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedSet#1` | fragment | fragment | ok | callers: src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2, src/repositories/set-entry.prisma.ts#deleteSet#1, src/repositories/set-entry.prisma.ts#deleteSet#2, src/repositories/set-entry.prisma.ts#deleteSet#3 | `057c8eaa34a2` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedPlannedSet#1` | fragment | fragment | ok | callers: none | `992af85c167f` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedWorkoutSection#1` | fragment | fragment | ok | callers: none | `2c3e5cef75b8` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineItem#1` | fragment | fragment | ok | callers: none | `3e79da3c1137` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineItemSet#1` | fragment | fragment | ok | callers: none | `eb74574133dd` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineSection#1` | fragment | fragment | ok | callers: none | `17617770fc72` | SQL piece composed into the callers listed |

## src/repositories/personal-record.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/personal-record.prisma.ts#lockUserRecords#1` | query | shared on purpose | ok | — | `7cc51da9df99` | Takes a transaction advisory lock (no table) |
| `src/repositories/personal-record.prisma.ts#rootsForWorkout#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `0afa4fc95c1a` | a workout's lineage roots (exercise ids, not user data), under the finish/retime/delete workout FOR UPDATE … user_id (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#rootOfWorkoutExercise#1` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `0cc4c987046c` | one exercise's lineage root, under the set write's workout lock (or the structure lock for an exercise delete) (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#repeatedRootOfWorkoutExercise#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `b207a6adf22d` | a moved exercise's lineage root and repeat count, under the structure lock (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#1` | fragment | fragment | ok | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `925780b92643` | SQL piece composed into the callers listed |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#2` | fragment | fragment | ok | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `40f7ae842572` | SQL piece composed into the callers listed |
| `src/repositories/personal-record.prisma.ts#resolveVisibleRoot#1` | query | user-filtered | ok | — | `47716a2b7a8c` | Reads exercise |
| `src/repositories/personal-record.prisma.ts#loadLineageSets#1` | query | user-filtered | ok | — | `214af96bd41f` | Reads set_entry, workout_exercise, workout, exercise, LATERAL |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#1` | query | user-filtered | ok | — | `01a436fa4821` | Deletes from personal_record |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#2` | query | user-filtered | ok | — | `94ae40360524` | Inserts into personal_record |
| `src/repositories/personal-record.prisma.ts#list#1` | query | user-filtered | ok | — | `876ffcc56867` | Reads personal_record, set_entry, workout_exercise |

## src/repositories/planned-sets.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/planned-sets.ts#plannedSetsJson#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1, src/repositories/workout.prisma.ts#WE_PLANNED_SETS#1 | `fe8a42f3e0bb` | SQL piece composed into the callers listed |

## src/repositories/routine-one-off.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine-one-off.prisma.ts#sweepExpiredOneOffs#1` | query | user-filtered | ok | — | `eff7be5bbe54` | Reads routine, workout |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#1` | query | user-filtered | ok | — | `16b9a2858646` | Reads routine, SKIP (FOR UPDATE) |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#2` | query | user-filtered | ok | — | `770b0bdc3f15` | Deletes from routine, workout |
| `src/repositories/routine-one-off.prisma.ts#lockOneOffForFinish#1` | query | user-filtered | ok | — | `13faf4a0bd5b` | Reads routine, workout (FOR UPDATE) |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#1` | query | user-filtered | ok | — | `63dd3338ba04` | Updates routine |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#2` | query | user-filtered | ok | — | `cd86a9a2c9d7` | Deletes from routine |

## src/repositories/routine.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine.prisma.ts#ITEM_COLS#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#2 | `0dfc438f2335` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#4, src/repositories/routine.prisma.ts#loadOne#1, src/repositories/routine.prisma.ts#list#1 | `b904b25c44c7` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#ROUTINE_ONE_OFF_ORDER#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#list#1 | `c7a788483a58` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#assertItemExercisesUsable#1` | query | user-filtered | ok | — | `a23e43966212` | Reads exercise |
| `src/repositories/routine.prisma.ts#insertSections#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertSections#2 | `5d0d957a4571` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertSections#2` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `64e3429a4529` | a routine's sections, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16) |
| `src/repositories/routine.prisma.ts#insertItems#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#2 | `45d257169604` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertItems#2` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `a69115ce9816` | a routine's items, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16) |
| `src/repositories/routine.prisma.ts#insertItems#3` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#4 | `07620384d0df` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertItems#4` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `d723d1f22c3d` | the items' planned sets, keyed by items this transaction just inserted (§6.7 #16) |
| `src/repositories/routine.prisma.ts#loadOne#1` | query | user-filtered | ok | — | `aa2fe47d63ee` | Reads routine_item, routine_section, routine |
| `src/repositories/routine.prisma.ts#list#1` | query | user-filtered | ok | — | `ca9f8e107446` | Reads routine_item, routine_section, routine |
| `src/repositories/routine.prisma.ts#create#1` | query | shared on purpose | ok | — | `c031bb1541e5` | Takes a transaction advisory lock (no table) |
| `src/repositories/routine.prisma.ts#create#2` | query | user-filtered | ok | — | `b6e025c0c380` | Reads routine |
| `src/repositories/routine.prisma.ts#create#3` | query | user-filtered | ok | — | `6cca491df63b` | Inserts into routine |
| `src/repositories/routine.prisma.ts#replace#1` | query | user-filtered | ok | — | `407e4e0cad01` | Reads routine (FOR UPDATE) |
| `src/repositories/routine.prisma.ts#replace#2` | query | user-filtered | ok | — | `1c1fe49b9680` | Updates routine |
| `src/repositories/routine.prisma.ts#replace#3` | query | anchored | ok | src/repositories/routine.prisma.ts#replace#1 | `fbad1165802f` | deletes the replaced routine's items, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16) |
| `src/repositories/routine.prisma.ts#replace#4` | query | anchored | ok | src/repositories/routine.prisma.ts#replace#1 | `acfc775315b9` | deletes the replaced routine's sections, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16) |
| `src/repositories/routine.prisma.ts#keep#1` | query | user-filtered | ok | — | `ff11f8aa3226` | Reads routine |
| `src/repositories/routine.prisma.ts#delete#1` | query | user-filtered | ok | — | `28b2b6a23841` | Deletes from routine |

## src/repositories/section-timer-columns.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/section-timer-columns.ts#timedFieldsJson#1` | fragment | fragment | ok | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2, src/repositories/workout.prisma.ts#workoutSectionsJson#1 | `9adad494c37e` | SQL piece composed into the callers listed |
| `src/repositories/section-timer-columns.ts#roundTimesJson#1` | fragment | fragment | ok | callers: src/repositories/section-timer-columns.ts#timedFieldsJson#1, src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1 | `8579653333d4` | SQL piece composed into the callers listed |

## src/repositories/set-entry.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/set-entry.prisma.ts#SET_ENTRY_COLUMNS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#7, src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1, src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1, src/repositories/set-entry.prisma.ts#createSet#5, src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2 | `adaaabb81498` | SQL piece composed into the callers listed |
| `src/repositories/set-entry.prisma.ts#resolveOwnedSet#1` | query | user-filtered | ok | — | `663edaad30df` | Reads set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1` | query | user-filtered | ok | — | `7be5ed766acd` | Reads set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1` | query | user-filtered | ok | — | `b80def5989fc` | Reads workout (FOR SHARE) |
| `src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1` | query | user-filtered | ok | — | `f32515c98d08` | Reads set_entry, workout_exercise; filtered on the workout exercise's own user_id (Spec 21.1) |
| `src/repositories/set-entry.prisma.ts#assertWouldNotEmpty#1` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `1411207183fa` | counts the workout's sets, keyed by the workout locked for the user (the structure lock on an exercise delete) (§6.7 #6) |
| `src/repositories/set-entry.prisma.ts#assertWorkingSetsComplete#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `aa02fe6c38b1` | the finish's working-set check, keyed by the workout locked FOR UPDATE … user_id (§6.7 #6) |
| `src/repositories/set-entry.prisma.ts#createSet#1` | query | user-filtered | ok | — | `103195613685` | Reads workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#createSet#2` | query | shared on purpose | ok | — | `52b787b8351a` | Takes a transaction advisory lock (no table) |
| `src/repositories/set-entry.prisma.ts#createSet#3` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `5d749cc1c9a4` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #3) |
| `src/repositories/set-entry.prisma.ts#createSet#4` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `83dd1d7fbb92` | the next set number of the workout exercise createSet#3 tied to the anchor |
| `src/repositories/set-entry.prisma.ts#createSet#5` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `06427852c963` | inserts the set into the workout exercise createSet#3 tied to the anchor |
| `src/repositories/set-entry.prisma.ts#updateSet#1` | query | user-filtered | ok | — | `724adea6de5a` | Reads set_entry, EXISTS, workout_exercise, workout (FOR UPDATE) |
| `src/repositories/set-entry.prisma.ts#updateSet#2` | query | user-filtered | ok | — | `c29bb2173bb4` | Updates set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#deleteSet#1` | query | user-filtered | ok | — | `57b5611291f6` | Deletes from set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#deleteSet#2` | query | user-filtered | ok | — | `709452b49405` | Reads set_entry, EXISTS, workout_exercise, workout (FOR UPDATE) |
| `src/repositories/set-entry.prisma.ts#deleteSet#3` | query | user-filtered | ok | — | `41061bf44de7` | Deletes from set_entry, workout_exercise, workout |

## src/repositories/user.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/user.prisma.ts#USER_COLUMNS#1` | fragment | fragment | ok | callers: src/repositories/user.prisma.ts#findByAuthSub#1, src/repositories/user.prisma.ts#provision#2, src/repositories/user.prisma.ts#syncEmail#1, src/repositories/user.prisma.ts#updateProfile#1 | `ccaa4f73c7ad` | The user row's columns |
| `src/repositories/user.prisma.ts#findByAuthSub#1` | query | user-filtered | ok | — | `73fe79d5eac4` | Reads user by the token's auth_sub |
| `src/repositories/user.prisma.ts#provision#1` | query | user-filtered | ok | — | `56779fd882c0` | Inserts into user |
| `src/repositories/user.prisma.ts#provision#2` | query | user-filtered | ok | — | `84cff2b3f403` | Re-reads user by the token's auth_sub |
| `src/repositories/user.prisma.ts#syncEmail#1` | query | user-filtered | ok | — | `f93bef1a79bf` | Updates user email by id |
| `src/repositories/user.prisma.ts#updateProfile#1` | query | user-filtered | ok | — | `85936da0da37` | Updates user profile by id |
| `src/repositories/user.prisma.ts#markDeleted#1` | query | user-filtered | ok | — | `b95aa720c9bd` | Updates user |

## src/repositories/workout-history.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-history.prisma.ts#loadWorkingSetRows#1` | query | user-filtered | ok | — | `b7c9327626ed` | Reads set_entry, workout_exercise; filtered on the workout exercise's own user_id (Spec 21.1) |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#1` | fragment | fragment | ok | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2 | `0d1812a17fd9` | SQL piece composed into the callers listed |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2` | query | user-filtered | ok | — | `e4d973a15972` | Reads workout_exercise, set_entry, personal_record, workout_section, workout, workout_section_round |

## src/repositories/workout-retime.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-retime.prisma.ts#userTimezone#1` | query | user-filtered | ok | — | `d28df78e6d8d` | Reads user |
| `src/repositories/workout-retime.prisma.ts#shiftSetTimes#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `3c6bc26e0bfa` | shifts set times of the workout locked FOR UPDATE … user_id (§6.7 #22) |
| `src/repositories/workout-retime.prisma.ts#clampSetTimes#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `49aacf85b11a` | clamps set times of the workout locked FOR UPDATE … user_id (§6.7 #22) |

## src/repositories/workout-section.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#1` | query | shared on purpose | ok | — | `ec3bc3b7c83d` | Transaction setting: SET CONSTRAINTS workout_exercise_position_key DEFERRED |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#2` | query | shared on purpose | ok | — | `8b1744b57e8c` | Takes a transaction advisory lock (no table) |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3` | query | user-filtered | ok | — | `05b6ad516ece` | Reads workout (FOR SHARE) |
| `src/repositories/workout-section.prisma.ts#workoutPreflight#1` | query | user-filtered | ok | — | `9a02ceaa722c` | Reads workout |
| `src/repositories/workout-section.prisma.ts#exerciseRanks#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `efa3fe198d05` | the workout's exercise ranks, under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1` | fragment | fragment | ok | callers: src/repositories/workout-section.prisma.ts#lockSectionThenRead#1, src/repositories/workout-section.prisma.ts#addWorkoutSection#2, src/repositories/workout-section.prisma.ts#updateWorkoutSection#2, src/repositories/workout-section.prisma.ts#setSectionResult#1 | `a23ad810b455` | SQL piece composed into the callers listed |
| `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1` | query | user-filtered | ok | — | `05b6ad516ece` | Reads workout (FOR SHARE) |
| `src/repositories/workout-section.prisma.ts#lockSectionRow#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `5afff9a16177` | locks the section, tied to the locked workout (workout_id = anchor; the structure lock on a timer PATCH) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#lockSectionThenRead#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `9566436a1875` | reads the section locked by lockSectionRow#1, tied to the same workout (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#sectionPreflight#1` | query | user-filtered | ok | — | `da465ebeb580` | Reads workout_section, workout |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `63bdd4579913` | counts the workout's sections, under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `46957f602ad7` | inserts a section into the workout under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `28b4770fd8a7` | clears the rounds of the section lockSectionThenRead tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `8a3abd633363` | updates the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `778fa9eaa097` | locks the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `6b35dfb6344e` | counts the exercises of the section #1 tied to the anchor (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `a0482ed9fe35` | deletes the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `6c7c61411aaf` | the later sections of the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `ed1322a7384e` | renumbers one of the sections #4 read from the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#setSectionRoundTime#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `3aad89234619` | upserts a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#clearSectionRoundTime#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `fe2d4fbb25ea` | deletes a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#setSectionResult#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `fc81722e07e5` | sets the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#clearSectionResult#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `4fc3d4037402` | clears the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |

## src/repositories/workout.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout.prisma.ts#workoutSectionsJson#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#5, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `c36f43831ce5` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#routineIsOneOffSql#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#5, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `edf8850fe9fc` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#WE_PLANNED_SETS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#6, src/repositories/workout.prisma.ts#loadExercises#1, src/repositories/workout.prisma.ts#updateWorkoutExercise#6 | `b16fa3e38f4d` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#finishedPatch#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `e026c0834424` | updates the finished workout's details, keyed by the workout locked FOR UPDATE … user_id |
| `src/repositories/workout.prisma.ts#loadExercises#1` | query | user-filtered | ok | — | `2b7aa90b02d4` | Reads workout_exercise; filtered on its own user_id (Spec 21.1) |
| `src/repositories/workout.prisma.ts#loadSectionSnapshot#1` | query | user-filtered | ok | — | `548377d8a4a9` | Reads workout, workout_section, workout_section_round, routine |
| `src/repositories/workout.prisma.ts#readWorkoutDetail#1` | query | user-filtered | ok | — | `f6f11fd550f1` | Reads workout |
| `src/repositories/workout.prisma.ts#countExercises#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `1982892da0bb` | counts a workout's exercises under the caller's workout lock (finish, delete, or the structure lock) (§6.7 #7) |
| `src/repositories/workout.prisma.ts#countAndLastSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `c5f2bff2caf7` | the exercise count and last section of the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#tryInsert#1` | query | user-filtered | ok | — | `696577b3ee00` | Inserts into workout |
| `src/repositories/workout.prisma.ts#insertFromRoutine#1` | query | user-filtered | ok | — | `3047ac339129` | Reads routine (FOR SHARE) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#2` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `4aaf4a8be480` | copies the routine's sections, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#3` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `117209f862ee` | reads the routine's items, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#4` | fragment | fragment | ok | callers: src/repositories/workout.prisma.ts#insertFromRoutine#5 | `97b34c54d81b` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#insertFromRoutine#5` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `7df3528437b6` | inserts the copied exercises into the new workout (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#6` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `d450311ec288` | copies the items' planned sets, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#7` | query | anchored | ok | src/repositories/workout.prisma.ts#tryInsert#1 | `b99b3f91c08e` | stamps the routine snapshot on the workout this transaction just inserted for the user (§6.7 #11) |
| `src/repositories/workout.prisma.ts#findByClientGeneratedId#1` | query | user-filtered | ok | — | `6167fd753c80` | Reads workout |
| `src/repositories/workout.prisma.ts#getActiveWorkout#1` | query | user-filtered | ok | — | `cbb672239342` | Reads workout |
| `src/repositories/workout.prisma.ts#updateWorkout#1` | query | user-filtered | ok | — | `971726a2eda0` | Reads workout (FOR UPDATE) |
| `src/repositories/workout.prisma.ts#updateWorkout#2` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `41a9ceea11f3` | updates the workout locked FOR UPDATE … user_id |
| `src/repositories/workout.prisma.ts#deleteWorkout#1` | query | user-filtered | ok | — | `f01d78b411df` | Reads workout (FOR UPDATE) |
| `src/repositories/workout.prisma.ts#deleteWorkout#2` | query | user-filtered | ok | — | `137959eba37e` | Deletes from hevy_link |
| `src/repositories/workout.prisma.ts#deleteWorkout#3` | query | user-filtered | ok | — | `8f4869d85ea0` | Deletes from workout |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `1f7b9b0b1657` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `e018db9c8475` | inserts the exercise into the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#1` | query | user-filtered | ok | — | `9904c515f01f` | Reads workout_exercise, workout |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `415c6f6f97ae` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `363d15c6bf2c` | the target section, tied to the locked workout (workout_id = anchor) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `18fbce02e2e8` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `d3f3af3316dc` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#6` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `a56cc1845d83` | updates the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#1` | query | user-filtered | ok | — | `8f1a9374d4a6` | Reads workout_exercise, workout |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `7d711890955f` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `0219f26c3a15` | counts the sets of the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `4ee4c7ff4114` | deletes the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `a268fafa667f` | closes the position gap in the locked workout (§6.7 #7) |

## src/seed/catalog.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/seed/catalog.ts#upsertReference#1` | fragment | fragment | ok | callers: src/seed/catalog.ts#upsertReference#2, src/seed/catalog.ts#upsertReference#3 | `0e0d9a507fe4` | SQL piece composed into the callers listed |
| `src/seed/catalog.ts#upsertReference#2` | query | cross-user maintenance | ok | — | `01a6b60f3952` | Reads no table |
| `src/seed/catalog.ts#upsertReference#3` | query | cross-user maintenance | ok | — | `03f2e9ee3787` | Inserts into SET |
| `src/seed/catalog.ts#seedCatalog#1` | query | cross-user maintenance | ok | — | `ebd28726c6c4` | Reads no table |
| `src/seed/catalog.ts#seedCatalog#2` | query | cross-user maintenance | ok | — | `f579901c14c5` | Reads exercise |
| `src/seed/catalog.ts#seedCatalog#3` | query | cross-user maintenance | ok | — | `59871ab375f0` | Reads exercise (FOR NO KEY UPDATE) |
| `src/seed/catalog.ts#seedCatalog#4` | query | cross-user maintenance | ok | — | `e165c3c74126` | Inserts into exercise |
| `src/seed/catalog.ts#seedCatalog#5` | query | cross-user maintenance | ok | — | `50367757bd39` | Updates exercise |
| `src/seed/catalog.ts#seedCatalog#6` | query | cross-user maintenance | ok | — | `6119dc9c4ead` | Updates exercise |
