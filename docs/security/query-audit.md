# Query audit (Spec 21.0)

Every SQL statement in `apps/api/src`, read and classified (Spec 21.0 §6.6). The rule everywhere is "you see your own
rows"; the only shared data is the reference catalog. This file is generated and checked: `apps/api/scripts/query-audit.ts`
extracts the statements from the TypeScript syntax tree, and a unit test fails when a statement is added, removed or edited
without its row changing here. After any SQL change run `pnpm --filter @sin/api run audit:queries --write`, then set the category of every row it marks
`needs review` (the test refuses that status).

Categories:

- **user-filtered**: the statement itself carries a user predicate (`user_id = $acting`, `owner_user_id IS NULL OR owner_user_id = $acting`, `id = $acting` on `"user"`, an `ownership.ts` helper, or an `INSERT` that writes the acting user's id).
- **anchored**: keyed by an id with no user predicate, but tied to an *anchor*: a user-filtered locking statement on the root row earlier in the same transaction (named in the Anchor column).
- **shared on purpose**: reference data (`muscle_group`, `equipment`, the catalog's `owner_user_id IS NULL` rows) or no table at all.
- **cross-user maintenance**: the operator scripts that act on many users (`account/purge.ts`, `records/rebuild.ts`, `seed/catalog.ts`).
- **fragment**: a piece composed into other statements, classified through the callers listed beside it.

## Summary

222 statements: 111 user-filtered, 54 anchored, 12 shared on purpose, 14 cross-user maintenance, 31 fragment.

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
| `src/account/purge.ts#listEligible#1` | query | cross-user maintenance | ok | — | `8188f2fd3ea5` | Reads workout, set_entry, workout_exercise, user |
| `src/account/purge.ts#classifyTarget#1` | query | cross-user maintenance | ok | — | `675af2124c26` | Reads user |
| `src/account/purge.ts#purgeAccount#1` | query | cross-user maintenance | ok | — | `b8ae84d98744` | Reads workout, set_entry, workout_exercise |
| `src/account/purge.ts#purgeAccount#2` | query | cross-user maintenance | ok | — | `08f77a5a3c1f` | Deletes from user |

## src/db.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db.ts#checkDatabaseReady#1` | query | shared on purpose | ok | — | `e004ebd5b553` | Reads no table |

## src/records/rebuild.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/records/rebuild.ts#rebuildUserRecords#1` | query | cross-user maintenance | ok | — | `258fa8cb46cf` | Reads workout, workout_exercise, exercise, personal_record |
| `src/records/rebuild.ts#rebuildRecords#1` | query | cross-user maintenance | ok | — | `0b01d41816d5` | Reads workout, personal_record |

## src/repositories/account-export.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/account-export.prisma.ts#snapshot#1` | query | shared on purpose | ok | — | `6c20e5345ee8` | Transaction setting: SET TRANSACTION READ ONLY |
| `src/repositories/account-export.prisma.ts#snapshot#2` | query | user-filtered | ok | — | `92d70735820a` | Reads hevy_exercise_pair, exercise, hevy_section_rule, hevy_link |
| `src/repositories/account-export.prisma.ts#snapshot#3` | query | user-filtered | ok | — | `dc3b4e5ace68` | Prisma user.findUniqueOrThrow |
| `src/repositories/account-export.prisma.ts#snapshot#4` | query | user-filtered | ok | — | `e3101f6f99f9` | Reads exercise |
| `src/repositories/account-export.prisma.ts#snapshot#5` | query | user-filtered | ok | — | `0245bc5106b2` | Reads routine_item, routine_section, routine |
| `src/repositories/account-export.prisma.ts#snapshot#6` | query | user-filtered | ok | — | `e53613a469db` | Reads workout, workout_section, workout_section_round, routine |
| `src/repositories/account-export.prisma.ts#snapshot#7` | query | user-filtered | ok | — | `c1ac50707fba` | Reads workout_exercise, workout |
| `src/repositories/account-export.prisma.ts#snapshot#8` | query | user-filtered | ok | — | `82f5d2942dd4` | Reads set_entry, workout_exercise, workout |

## src/repositories/exercise.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/exercise.prisma.ts#exerciseColumns#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#4, src/repositories/exercise.prisma.ts#loadVisibleRow#1, src/repositories/exercise.prisma.ts#insertWithCap#2, src/repositories/exercise.prisma.ts#findCatalog#1, src/repositories/exercise.prisma.ts#findCatalog#2, src/repositories/exercise.prisma.ts#updateExercise#2 | `cf686597f37d` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#lineageHasSetsSql#1` | fragment | fragment | ok | callers: src/repositories/exercise.prisma.ts#lineageHasSets#1, src/repositories/exercise.prisma.ts#updateExercise#1 | `b65216f1033d` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#lineageHasSets#1` | query | user-filtered | ok | — | `0b89e7afcfae` | Reads workout_exercise, workout, set_entry, exercise |
| `src/repositories/exercise.prisma.ts#loadVisibleRow#1` | query | user-filtered | ok | — | `c99421e9d4ae` | Reads exercise |
| `src/repositories/exercise.prisma.ts#validateReferences#1` | query | shared on purpose | ok | — | `01716f4e1694` | Reads muscle_group |
| `src/repositories/exercise.prisma.ts#validateReferences#2` | query | shared on purpose | ok | — | `9d8bd0000f63` | Reads equipment |
| `src/repositories/exercise.prisma.ts#insertWithCap#1` | query | shared on purpose | ok | — | `4e5edf8359fa` | Takes a transaction advisory lock (no table) |
| `src/repositories/exercise.prisma.ts#insertWithCap#2` | query | user-filtered | ok | — | `70438bdefdf4` | Reads exercise, _cap |
| `src/repositories/exercise.prisma.ts#findCatalog#1` | query | user-filtered | ok | — | `5ec58bce194e` | Reads snap, exercise |
| `src/repositories/exercise.prisma.ts#findCatalog#2` | query | user-filtered | ok | — | `d9aaf2d5bef2` | Reads snap, exercise |
| `src/repositories/exercise.prisma.ts#updateExercise#1` | fragment | fragment | ok | callers: src/repositories/exercise.prisma.ts#updateExercise#2 | `996243938463` | SQL piece composed into the callers listed |
| `src/repositories/exercise.prisma.ts#updateExercise#2` | query | user-filtered | ok | — | `dd1d39e30081` | Updates exercise, workout_exercise, workout, set_entry |
| `src/repositories/exercise.prisma.ts#listRoutinesUsing#1` | query | user-filtered | ok | — | `5de40a41148d` | Reads routine, routine_item |
| `src/repositories/exercise.prisma.ts#findUsage#1` | query | user-filtered | ok | — | `a9e4f33de622` | Reads workout, workout_exercise, exercise, set_entry |
| `src/repositories/exercise.prisma.ts#deleteExercise#1` | query | user-filtered | ok | — | `fabaf40135a1` | Updates exercise |
| `src/repositories/exercise.prisma.ts#listMuscleGroups#1` | query | shared on purpose | ok | — | `cb9e6396384e` | Reads muscle_group |
| `src/repositories/exercise.prisma.ts#listEquipment#1` | query | shared on purpose | ok | — | `c08d7deb0c23` | Reads equipment |

## src/repositories/hevy-import.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy-import.prisma.ts#loadContext#1` | query | user-filtered | ok | — | `7ade0afab77b` | Reads exercise |
| `src/repositories/hevy-import.prisma.ts#loadContext#2` | query | user-filtered | ok | — | `ef233b629126` | Reads user |
| `src/repositories/hevy-import.prisma.ts#findLinks#1` | query | user-filtered | ok | — | `105af8c51bfd` | Reads hevy_link |
| `src/repositories/hevy-import.prisma.ts#findCandidates#1` | query | user-filtered | ok | — | `30ed94302812` | Reads workout, workout_exercise, exercise, hevy_link |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#1` | query | user-filtered | ok | — | `4b1b775cf486` | Reads exercise (FOR SHARE) |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2` | query | user-filtered | ok | — | `a801a35ceb4f` | Inserts into workout |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#3` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `5cd821fdbcc2` | the imported workout's sections, keyed by the workout this transaction just inserted for the user |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#4` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `d761ca32491b` | the imported workout's exercises, keyed by the workout this transaction just inserted for the user |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#5` | fragment | fragment | ok | callers: src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6 | `49e02910e650` | SQL piece composed into the callers listed |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6` | query | anchored | ok | src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2 | `38ca2d091080` | the imported sets, keyed by exercises this transaction just inserted |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#7` | query | user-filtered | ok | — | `3fdfd019ad90` | Inserts into hevy_link |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#8` | query | user-filtered | ok | — | `9dfe4c2df356` | Inserts into hevy_account, SET |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#1` | query | user-filtered | ok | — | `9c856ba4bcd8` | Reads workout (FOR SHARE) |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#2` | query | user-filtered | ok | — | `19c3ab016ee6` | Inserts into hevy_link |
| `src/repositories/hevy-import.prisma.ts#finishImport#1` | query | user-filtered | ok | — | `de44c0c80114` | Reads hevy_account (FOR UPDATE) |
| `src/repositories/hevy-import.prisma.ts#finishImport#2` | query | user-filtered | ok | — | `01ae13c53433` | Updates hevy_account |

## src/repositories/hevy.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy.prisma.ts#readHevyMapping#1` | query | user-filtered | ok | — | `5ec8b46ed44d` | Reads hevy_exercise_pair, exercise |
| `src/repositories/hevy.prisma.ts#readHevyMapping#2` | query | user-filtered | ok | — | `c1a1af4dae06` | Reads hevy_section_rule |
| `src/repositories/hevy.prisma.ts#lockUser#1` | query | user-filtered | ok | — | `c2033235523f` | Reads user (FOR NO KEY UPDATE) |
| `src/repositories/hevy.prisma.ts#visibleExercises#1` | query | user-filtered | ok | — | `5571c03dc370` | Reads exercise |
| `src/repositories/hevy.prisma.ts#insertPairs#1` | query | user-filtered | ok | — | `02975ccbe91d` | Inserts into hevy_exercise_pair, unnest, SET |
| `src/repositories/hevy.prisma.ts#settleExportAs#1` | query | user-filtered | ok | — | `9c2a707efc05` | Reads hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#2` | query | user-filtered | ok | — | `dcd0c1a325ba` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#3` | query | user-filtered | ok | — | `9fffe8f601ab` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#settleExportAs#4` | query | user-filtered | ok | — | `7c1d64caeb74` | Updates hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#linkRow#1` | query | user-filtered | ok | — | `17276bdcb8d7` | Reads hevy_link (FOR UPDATE) |
| `src/repositories/hevy.prisma.ts#linkRow#2` | query | user-filtered | ok | — | `e22a6ce1800b` | Reads hevy_link |
| `src/repositories/hevy.prisma.ts#status#1` | query | user-filtered | ok | — | `ddad2662b3f6` | Reads hevy_exercise_pair, hevy_link, hevy_account |
| `src/repositories/hevy.prisma.ts#replaceMapping#1` | query | user-filtered | ok | — | `4be6c59decce` | Deletes from hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#replaceMapping#2` | query | user-filtered | ok | — | `56962a887b6e` | Deletes from hevy_section_rule |
| `src/repositories/hevy.prisma.ts#replaceMapping#3` | query | user-filtered | ok | — | `20898922bb61` | Inserts into hevy_section_rule, unnest |
| `src/repositories/hevy.prisma.ts#patchMapping#1` | query | user-filtered | ok | — | `17b0850c62ac` | Reads hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#patchMapping#2` | query | user-filtered | ok | — | `c11765251a39` | Deletes from hevy_exercise_pair |
| `src/repositories/hevy.prisma.ts#beginLink#1` | query | user-filtered | ok | — | `1adc1c85771e` | Reads workout (FOR UPDATE) |
| `src/repositories/hevy.prisma.ts#beginLink#2` | query | user-filtered | ok | — | `2eefcfd42280` | Inserts into hevy_link |
| `src/repositories/hevy.prisma.ts#beginLink#3` | query | user-filtered | ok | — | `21e46fb0e239` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#beginLink#4` | query | user-filtered | ok | — | `6927d8caff33` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#completeLink#1` | query | user-filtered | ok | — | `9c856ba4bcd8` | Reads workout (FOR SHARE) |
| `src/repositories/hevy.prisma.ts#completeLink#2` | query | user-filtered | ok | — | `0ea914bdcf40` | Reads hevy_link |
| `src/repositories/hevy.prisma.ts#completeLink#3` | query | user-filtered | ok | — | `94af6de17a6c` | Updates hevy_link |
| `src/repositories/hevy.prisma.ts#releaseLink#1` | query | user-filtered | ok | — | `9c856ba4bcd8` | Reads workout (FOR SHARE) |
| `src/repositories/hevy.prisma.ts#releaseLink#2` | query | user-filtered | ok | — | `b0442de28d4d` | Deletes from hevy_link |
| `src/repositories/hevy.prisma.ts#releaseLink#3` | query | user-filtered | ok | — | `2805bee28368` | Updates hevy_link |

## src/repositories/ownership.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/ownership.ts#ownedWorkoutExercise#1` | fragment | fragment | ok | callers: src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1 | `7e3c56f9e254` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedSet#1` | fragment | fragment | ok | callers: src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2, src/repositories/set-entry.prisma.ts#deleteSet#1, src/repositories/set-entry.prisma.ts#deleteSet#2, src/repositories/set-entry.prisma.ts#deleteSet#3 | `714590bf093e` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedPlannedSet#1` | fragment | fragment | ok | callers: none | `2bfd25df096f` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedWorkoutSection#1` | fragment | fragment | ok | callers: none | `1a0304d4252a` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedSectionRound#1` | fragment | fragment | ok | callers: none | `1a0304d4252a` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineItem#1` | fragment | fragment | ok | callers: none | `2ef3600b3bd9` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineItemSet#1` | fragment | fragment | ok | callers: none | `8832281cf14d` | SQL piece composed into the callers listed |
| `src/repositories/ownership.ts#ownedRoutineSection#1` | fragment | fragment | ok | callers: none | `333253fff283` | SQL piece composed into the callers listed |

## src/repositories/personal-record.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/personal-record.prisma.ts#lockUserRecords#1` | query | shared on purpose | ok | — | `7cc51da9df99` | Takes a transaction advisory lock (no table) |
| `src/repositories/personal-record.prisma.ts#rootsForWorkout#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `e2b84e41d226` | a workout's lineage roots (exercise ids, not user data), under the finish/retime/delete workout FOR UPDATE … user_id (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#rootOfWorkoutExercise#1` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `2c3c957fc83d` | one exercise's lineage root, under the set write's workout lock (or the structure lock for an exercise delete) (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#repeatedRootOfWorkoutExercise#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `8a66ecef61b3` | a moved exercise's lineage root and repeat count, under the structure lock (§6.7 #20) |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#1` | fragment | fragment | ok | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `56637d7e5e7e` | SQL piece composed into the callers listed |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#2` | fragment | fragment | ok | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `4b8608eb7053` | SQL piece composed into the callers listed |
| `src/repositories/personal-record.prisma.ts#resolveVisibleRoot#1` | query | user-filtered | ok | — | `42f92ae7ff68` | Reads exercise |
| `src/repositories/personal-record.prisma.ts#loadLineageSets#1` | query | user-filtered | ok | — | `b9b8d90eac52` | Reads set_entry, workout_exercise, workout, exercise, LATERAL |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#1` | query | user-filtered | ok | — | `2420fd4a10fd` | Deletes from personal_record |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#2` | query | user-filtered | ok | — | `6b28ea11dcfc` | Inserts into personal_record |
| `src/repositories/personal-record.prisma.ts#list#1` | query | user-filtered | ok | — | `7a2084cc6bca` | Reads personal_record, set_entry, workout_exercise |

## src/repositories/planned-sets.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/planned-sets.ts#plannedSetsJson#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1, src/repositories/workout.prisma.ts#WE_PLANNED_SETS#1 | `e11e50226d59` | SQL piece composed into the callers listed |

## src/repositories/routine-one-off.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine-one-off.prisma.ts#sweepExpiredOneOffs#1` | query | user-filtered | ok | — | `4faaa9529e2d` | Reads routine, workout |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#1` | query | user-filtered | ok | — | `6b268fac919a` | Reads routine, SKIP (FOR UPDATE) |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#2` | query | user-filtered | ok | — | `bb11ebf7f5d4` | Deletes from routine, workout |
| `src/repositories/routine-one-off.prisma.ts#lockOneOffForFinish#1` | query | user-filtered | ok | — | `db9f479d25af` | Reads routine, workout (FOR UPDATE) |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#1` | query | user-filtered | ok | — | `2fe74f00f5dd` | Updates routine |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#2` | query | user-filtered | ok | — | `00dae8f9e639` | Deletes from routine |

## src/repositories/routine.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine.prisma.ts#ITEM_COLS#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#2 | `0dfc438f2335` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#5, src/repositories/routine.prisma.ts#loadOne#1, src/repositories/routine.prisma.ts#list#1 | `32652e61c01d` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#ROUTINE_ONE_OFF_ORDER#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#list#1 | `c7a788483a58` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#assertItemExercisesUsable#1` | query | user-filtered | ok | — | `910f331c4de4` | Reads exercise |
| `src/repositories/routine.prisma.ts#insertSections#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertSections#2 | `4c298fb6d337` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertSections#2` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `64e3429a4529` | a routine's sections, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16) |
| `src/repositories/routine.prisma.ts#insertItems#1` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#2 | `d8112dfacad7` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertItems#2` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `a69115ce9816` | a routine's items, keyed by the routine created (or, on PUT, locked by replace#1) for the user (§6.7 #16) |
| `src/repositories/routine.prisma.ts#insertItems#3` | fragment | fragment | ok | callers: src/repositories/routine.prisma.ts#insertItems#4 | `c782c5c187a9` | SQL piece composed into the callers listed |
| `src/repositories/routine.prisma.ts#insertItems#4` | query | anchored | ok | src/repositories/routine.prisma.ts#create#3 | `d723d1f22c3d` | the items' planned sets, keyed by items this transaction just inserted (§6.7 #16) |
| `src/repositories/routine.prisma.ts#loadOne#1` | query | user-filtered | ok | — | `aa2fe47d63ee` | Reads routine_item, routine_section, routine |
| `src/repositories/routine.prisma.ts#list#1` | query | user-filtered | ok | — | `ca9f8e107446` | Reads routine_item, routine_section, routine |
| `src/repositories/routine.prisma.ts#create#1` | query | shared on purpose | ok | — | `4e5edf8359fa` | Takes a transaction advisory lock (no table) |
| `src/repositories/routine.prisma.ts#create#2` | query | user-filtered | ok | — | `6c6cd461567e` | Reads routine |
| `src/repositories/routine.prisma.ts#create#3` | query | user-filtered | ok | — | `e877dcea99ec` | Inserts into routine |
| `src/repositories/routine.prisma.ts#replace#1` | query | user-filtered | ok | — | `1e9864e2ad4c` | Reads routine (FOR UPDATE) |
| `src/repositories/routine.prisma.ts#replace#2` | query | user-filtered | ok | — | `01e5a135e24d` | Updates routine |
| `src/repositories/routine.prisma.ts#replace#3` | query | anchored | ok | src/repositories/routine.prisma.ts#replace#1 | `7262f99ce859` | deletes the replaced routine's items, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16) |
| `src/repositories/routine.prisma.ts#replace#4` | query | anchored | ok | src/repositories/routine.prisma.ts#replace#1 | `d26eb157535d` | deletes the replaced routine's sections, keyed by the routine locked FOR UPDATE … user_id (§6.7 #16) |
| `src/repositories/routine.prisma.ts#keep#1` | query | user-filtered | ok | — | `dcb9da2b5ad9` | Reads routine |
| `src/repositories/routine.prisma.ts#delete#1` | query | user-filtered | ok | — | `d8dfcb723516` | Deletes from routine |

## src/repositories/section-timer-columns.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/section-timer-columns.ts#timedFieldsJson#1` | fragment | fragment | ok | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2, src/repositories/workout.prisma.ts#workoutSectionsJson#1 | `6468b05507ac` | SQL piece composed into the callers listed |
| `src/repositories/section-timer-columns.ts#roundTimesJson#1` | fragment | fragment | ok | callers: src/repositories/section-timer-columns.ts#timedFieldsJson#1, src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1 | `f3f6d420baca` | SQL piece composed into the callers listed |

## src/repositories/set-entry.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/set-entry.prisma.ts#SET_ENTRY_COLUMNS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#8, src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1, src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1, src/repositories/set-entry.prisma.ts#createSet#5, src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2 | `adaaabb81498` | SQL piece composed into the callers listed |
| `src/repositories/set-entry.prisma.ts#resolveOwnedSet#1` | query | user-filtered | ok | — | `045992f3e63a` | Reads set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1` | query | user-filtered | ok | — | `660b0cf382ac` | Reads set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1` | query | user-filtered | ok | — | `4159706d3416` | Reads workout (FOR SHARE) |
| `src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1` | query | user-filtered | ok | — | `915613309fd7` | Reads set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#assertWouldNotEmpty#1` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `165006109380` | counts the workout's sets, keyed by the workout locked for the user (the structure lock on an exercise delete) (§6.7 #6) |
| `src/repositories/set-entry.prisma.ts#assertWorkingSetsComplete#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `b868941c9eee` | the finish's working-set check, keyed by the workout locked FOR UPDATE … user_id (§6.7 #6) |
| `src/repositories/set-entry.prisma.ts#createSet#1` | query | user-filtered | ok | — | `f09f975ad826` | Reads workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#createSet#2` | query | shared on purpose | ok | — | `4e5edf8359fa` | Takes a transaction advisory lock (no table) |
| `src/repositories/set-entry.prisma.ts#createSet#3` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `43f44ed194a8` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #3) |
| `src/repositories/set-entry.prisma.ts#createSet#4` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `95a70998a0c6` | the next set number of the workout exercise createSet#3 tied to the anchor |
| `src/repositories/set-entry.prisma.ts#createSet#5` | query | anchored | ok | src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1 | `dd58361a485d` | inserts the set into the workout exercise createSet#3 tied to the anchor |
| `src/repositories/set-entry.prisma.ts#updateSet#1` | query | user-filtered | ok | — | `4dbd6e9794f8` | Reads set_entry, EXISTS, workout_exercise, workout (FOR UPDATE) |
| `src/repositories/set-entry.prisma.ts#updateSet#2` | query | user-filtered | ok | — | `d4801cf82b39` | Updates set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#deleteSet#1` | query | user-filtered | ok | — | `6cea45ab3f27` | Deletes from set_entry, workout_exercise, workout |
| `src/repositories/set-entry.prisma.ts#deleteSet#2` | query | user-filtered | ok | — | `cc9fe2cfdadb` | Reads set_entry, EXISTS, workout_exercise, workout (FOR UPDATE) |
| `src/repositories/set-entry.prisma.ts#deleteSet#3` | query | user-filtered | ok | — | `763793d7909c` | Deletes from set_entry, workout_exercise, workout |

## src/repositories/user.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/user.prisma.ts#findByAuthSub#1` | query | user-filtered | ok | — | `5d2499d2199b` | Prisma user.findUnique |
| `src/repositories/user.prisma.ts#provision#1` | query | user-filtered | ok | — | `2295a1d80413` | Inserts into user |
| `src/repositories/user.prisma.ts#provision#2` | query | user-filtered | ok | — | `da49cdd4384b` | Prisma user.findUnique |
| `src/repositories/user.prisma.ts#syncEmail#1` | query | user-filtered | ok | — | `f6572ed731ab` | Prisma user.update |
| `src/repositories/user.prisma.ts#updateProfile#1` | query | user-filtered | ok | — | `0093c718f96d` | Prisma user.update |
| `src/repositories/user.prisma.ts#markDeleted#1` | query | user-filtered | ok | — | `d8f4f4fd405f` | Updates user |

## src/repositories/workout-history.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-history.prisma.ts#loadWorkingSetRows#1` | query | user-filtered | ok | — | `377c601fae78` | Reads set_entry, workout_exercise, workout |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#1` | fragment | fragment | ok | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2 | `6d1557133124` | SQL piece composed into the callers listed |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2` | query | user-filtered | ok | — | `94395644ab77` | Reads workout_exercise, set_entry, personal_record, workout_section, workout, workout_section_round |

## src/repositories/workout-retime.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-retime.prisma.ts#userTimezone#1` | query | user-filtered | ok | — | `4387b45c584d` | Reads user |
| `src/repositories/workout-retime.prisma.ts#shiftSetTimes#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `1602fa550862` | shifts set times of the workout locked FOR UPDATE … user_id (§6.7 #22) |
| `src/repositories/workout-retime.prisma.ts#clampSetTimes#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `475a63eef2b5` | clamps set times of the workout locked FOR UPDATE … user_id (§6.7 #22) |

## src/repositories/workout-section.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#1` | query | shared on purpose | ok | — | `ec3bc3b7c83d` | Transaction setting: SET CONSTRAINTS workout_exercise_position_key DEFERRED |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#2` | query | shared on purpose | ok | — | `4e5edf8359fa` | Takes a transaction advisory lock (no table) |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3` | query | user-filtered | ok | — | `383433784a9b` | Reads workout (FOR SHARE) |
| `src/repositories/workout-section.prisma.ts#workoutPreflight#1` | query | user-filtered | ok | — | `ded271a424c4` | Reads workout |
| `src/repositories/workout-section.prisma.ts#exerciseRanks#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `8969e27201cc` | the workout's exercise ranks, under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1` | fragment | fragment | ok | callers: src/repositories/workout-section.prisma.ts#lockSectionThenRead#1, src/repositories/workout-section.prisma.ts#addWorkoutSection#2, src/repositories/workout-section.prisma.ts#updateWorkoutSection#2, src/repositories/workout-section.prisma.ts#setSectionResult#1 | `a23ad810b455` | SQL piece composed into the callers listed |
| `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1` | query | user-filtered | ok | — | `383433784a9b` | Reads workout (FOR SHARE) |
| `src/repositories/workout-section.prisma.ts#lockSectionRow#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `e73b8f7cc778` | locks the section, tied to the locked workout (workout_id = anchor; the structure lock on a timer PATCH) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#lockSectionThenRead#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `98b058d9b36d` | reads the section locked by lockSectionRow#1, tied to the same workout (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#sectionPreflight#1` | query | user-filtered | ok | — | `9d62aab4da0b` | Reads workout_section, workout |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `d43f261e49a0` | counts the workout's sections, under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `b54276b3d628` | inserts a section into the workout under the structure lock (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `cf6791aa223e` | clears the rounds of the section lockSectionThenRead tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `2045550b895e` | updates the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `bb8c4ce0dd9f` | locks the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `a97e8278fad5` | counts the exercises of the section #1 tied to the anchor (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `0742b3d5b649` | deletes the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `cae68b97f60d` | the later sections of the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `bc35bdc3e321` | renumbers one of the sections #4 read from the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#setSectionRoundTime#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `af94b307b3c4` | upserts a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#clearSectionRoundTime#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `f37b593169c4` | deletes a round of the section lockSectionRow#1 tied to the locked workout (§6.7 #14) |
| `src/repositories/workout-section.prisma.ts#setSectionResult#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `888cfd01e35a` | sets the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |
| `src/repositories/workout-section.prisma.ts#clearSectionResult#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1 | `41019e8aca35` | clears the result of the section, tied to the locked workout (workout_id = anchor) (§6.7 #13) |

## src/repositories/workout.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout.prisma.ts#workoutSectionsJson#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#6, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `8a436a3f4a1b` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#routineIsOneOffSql#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#6, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `89946946892d` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#WE_PLANNED_SETS#1` | fragment | fragment | ok | callers: src/repositories/account-export.prisma.ts#snapshot#7, src/repositories/workout.prisma.ts#loadExercises#1, src/repositories/workout.prisma.ts#updateWorkoutExercise#6 | `b16fa3e38f4d` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#finishedPatch#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `fcec8810aef6` | updates the finished workout's details, keyed by the workout locked FOR UPDATE … user_id |
| `src/repositories/workout.prisma.ts#loadExercises#1` | query | user-filtered | ok | — | `0fad4267bd4d` | Reads workout_exercise, workout |
| `src/repositories/workout.prisma.ts#loadSectionSnapshot#1` | query | user-filtered | ok | — | `ba32f99404f7` | Reads workout, workout_section, workout_section_round, routine |
| `src/repositories/workout.prisma.ts#readWorkoutDetail#1` | query | user-filtered | ok | — | `f770297448fc` | Reads workout |
| `src/repositories/workout.prisma.ts#countExercises#1` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `3db15f3e1c79` | counts a workout's exercises under the caller's workout lock (finish, delete, or the structure lock) (§6.7 #7) |
| `src/repositories/workout.prisma.ts#countAndLastSection#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `f77bca7afcdd` | the exercise count and last section of the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#tryInsert#1` | query | user-filtered | ok | — | `d55f7006991a` | Inserts into workout |
| `src/repositories/workout.prisma.ts#insertFromRoutine#1` | query | user-filtered | ok | — | `59da7b81a35d` | Reads routine (FOR SHARE) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#2` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `02c90d0ee0ff` | copies the routine's sections, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#3` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `bebc86e1d38a` | reads the routine's items, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#4` | fragment | fragment | ok | callers: src/repositories/workout.prisma.ts#insertFromRoutine#5 | `40bad70e016d` | SQL piece composed into the callers listed |
| `src/repositories/workout.prisma.ts#insertFromRoutine#5` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `7df3528437b6` | inserts the copied exercises into the new workout (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#6` | query | anchored | ok | src/repositories/workout.prisma.ts#insertFromRoutine#1 | `32f8a07782b5` | copies the items' planned sets, under the routine FOR SHARE … user_id (§6.7 #11) |
| `src/repositories/workout.prisma.ts#insertFromRoutine#7` | query | anchored | ok | src/repositories/workout.prisma.ts#tryInsert#1 | `a16e3ed2ea52` | stamps the routine snapshot on the workout this transaction just inserted for the user (§6.7 #11) |
| `src/repositories/workout.prisma.ts#findByClientGeneratedId#1` | query | user-filtered | ok | — | `5299e0e839b6` | Reads workout |
| `src/repositories/workout.prisma.ts#getActiveWorkout#1` | query | user-filtered | ok | — | `de94af128bbd` | Reads workout |
| `src/repositories/workout.prisma.ts#updateWorkout#1` | query | user-filtered | ok | — | `29f51b27f004` | Reads workout (FOR UPDATE) |
| `src/repositories/workout.prisma.ts#updateWorkout#2` | query | anchored | ok | src/repositories/workout.prisma.ts#updateWorkout#1 | `bfcef0703916` | updates the workout locked FOR UPDATE … user_id |
| `src/repositories/workout.prisma.ts#deleteWorkout#1` | query | user-filtered | ok | — | `ee61915a23c7` | Reads workout (FOR UPDATE) |
| `src/repositories/workout.prisma.ts#deleteWorkout#2` | query | user-filtered | ok | — | `b0442de28d4d` | Deletes from hevy_link |
| `src/repositories/workout.prisma.ts#deleteWorkout#3` | query | user-filtered | ok | — | `1a31ed921a35` | Deletes from workout |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#1` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `f390beb56ea7` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `2a91f8f8dc1b` | inserts the exercise into the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#1` | query | user-filtered | ok | — | `f606f46b7de3` | Reads workout_exercise, workout |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `abff81183eca` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `6e9ed8d47690` | the target section, tied to the locked workout (workout_id = anchor) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `6793ac30e460` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `acbd7796c1c3` | shifts positions in the locked workout (§6.7 #7) |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#6` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `2dfa87b3bb6c` | updates the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#1` | query | user-filtered | ok | — | `dab0c88e02cf` | Reads workout_exercise, workout |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#2` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `b54698eb10f7` | locks the request's workout exercise, tied to the locked workout (workout_id = anchor) (§6.7 #8) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#3` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `f8dbb736d3a3` | counts the sets of the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#4` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `f4b61ebfaf96` | deletes the workout exercise #2 tied to the anchor (§6.7 #9) |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#5` | query | anchored | ok | src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3 | `a1e24450e01e` | closes the position gap in the locked workout (§6.7 #7) |

## src/seed/catalog.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/seed/catalog.ts#upsertReference#1` | fragment | fragment | ok | callers: src/seed/catalog.ts#upsertReference#2, src/seed/catalog.ts#upsertReference#3 | `15c5e748338b` | SQL piece composed into the callers listed |
| `src/seed/catalog.ts#upsertReference#2` | query | cross-user maintenance | ok | — | `54c82c2ab712` | Reads no table |
| `src/seed/catalog.ts#upsertReference#3` | query | cross-user maintenance | ok | — | `52f3dc6c0351` | Inserts into SET |
| `src/seed/catalog.ts#seedCatalog#1` | query | cross-user maintenance | ok | — | `ebd28726c6c4` | Reads no table |
| `src/seed/catalog.ts#seedCatalog#2` | query | cross-user maintenance | ok | — | `f579901c14c5` | Reads exercise |
| `src/seed/catalog.ts#seedCatalog#3` | query | cross-user maintenance | ok | — | `3db93d63cacd` | Reads exercise (FOR NO KEY UPDATE) |
| `src/seed/catalog.ts#seedCatalog#4` | query | cross-user maintenance | ok | — | `e095c76cde53` | Inserts into exercise |
| `src/seed/catalog.ts#seedCatalog#5` | query | cross-user maintenance | ok | — | `9925eeb15ace` | Updates exercise |
| `src/seed/catalog.ts#seedCatalog#6` | query | cross-user maintenance | ok | — | `20da42d7bf2f` | Updates exercise |
