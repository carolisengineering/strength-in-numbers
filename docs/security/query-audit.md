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

216 statements: 216 uncategorized. **216 need review.**

### Statements that rely on an earlier check (anchored)

None.

## src/account/purge.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/account/purge.ts#listEligible#1` | query | uncategorized | needs review | — | `8188f2fd3ea5` |  |
| `src/account/purge.ts#classifyTarget#1` | query | uncategorized | needs review | — | `675af2124c26` |  |
| `src/account/purge.ts#purgeAccount#1` | query | uncategorized | needs review | — | `b8ae84d98744` |  |
| `src/account/purge.ts#purgeAccount#2` | query | uncategorized | needs review | — | `08f77a5a3c1f` |  |

## src/db.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/db.ts#checkDatabaseReady#1` | query | uncategorized | needs review | — | `e004ebd5b553` |  |

## src/records/rebuild.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/records/rebuild.ts#rebuildUserRecords#1` | query | uncategorized | needs review | — | `258fa8cb46cf` |  |
| `src/records/rebuild.ts#rebuildRecords#1` | query | uncategorized | needs review | — | `0b01d41816d5` |  |

## src/repositories/account-export.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/account-export.prisma.ts#snapshot#1` | query | uncategorized | needs review | — | `6c20e5345ee8` |  |
| `src/repositories/account-export.prisma.ts#snapshot#2` | query | uncategorized | needs review | — | `92d70735820a` |  |
| `src/repositories/account-export.prisma.ts#snapshot#3` | query | uncategorized | needs review | — | `e3101f6f99f9` |  |
| `src/repositories/account-export.prisma.ts#snapshot#4` | query | uncategorized | needs review | — | `0245bc5106b2` |  |
| `src/repositories/account-export.prisma.ts#snapshot#5` | query | uncategorized | needs review | — | `e53613a469db` |  |
| `src/repositories/account-export.prisma.ts#snapshot#6` | query | uncategorized | needs review | — | `c1ac50707fba` |  |
| `src/repositories/account-export.prisma.ts#snapshot#7` | query | uncategorized | needs review | — | `82f5d2942dd4` |  |

## src/repositories/exercise.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/exercise.prisma.ts#exerciseColumns#1` | fragment | uncategorized | needs review | callers: src/repositories/account-export.prisma.ts#snapshot#3, src/repositories/exercise.prisma.ts#loadVisibleRow#1, src/repositories/exercise.prisma.ts#insertWithCap#2, src/repositories/exercise.prisma.ts#findCatalog#1, src/repositories/exercise.prisma.ts#findCatalog#2, src/repositories/exercise.prisma.ts#updateExercise#2 | `cf686597f37d` |  |
| `src/repositories/exercise.prisma.ts#lineageHasSetsSql#1` | fragment | uncategorized | needs review | callers: src/repositories/exercise.prisma.ts#lineageHasSets#1, src/repositories/exercise.prisma.ts#updateExercise#1 | `b65216f1033d` |  |
| `src/repositories/exercise.prisma.ts#lineageHasSets#1` | query | uncategorized | needs review | — | `0b89e7afcfae` |  |
| `src/repositories/exercise.prisma.ts#loadVisibleRow#1` | query | uncategorized | needs review | — | `c99421e9d4ae` |  |
| `src/repositories/exercise.prisma.ts#validateReferences#1` | query | uncategorized | needs review | — | `01716f4e1694` |  |
| `src/repositories/exercise.prisma.ts#validateReferences#2` | query | uncategorized | needs review | — | `9d8bd0000f63` |  |
| `src/repositories/exercise.prisma.ts#insertWithCap#1` | query | uncategorized | needs review | — | `4e5edf8359fa` |  |
| `src/repositories/exercise.prisma.ts#insertWithCap#2` | query | uncategorized | needs review | — | `70438bdefdf4` |  |
| `src/repositories/exercise.prisma.ts#findCatalog#1` | query | uncategorized | needs review | — | `5ec58bce194e` |  |
| `src/repositories/exercise.prisma.ts#findCatalog#2` | query | uncategorized | needs review | — | `d9aaf2d5bef2` |  |
| `src/repositories/exercise.prisma.ts#updateExercise#1` | fragment | uncategorized | needs review | callers: src/repositories/exercise.prisma.ts#updateExercise#2 | `996243938463` |  |
| `src/repositories/exercise.prisma.ts#updateExercise#2` | query | uncategorized | needs review | — | `dd1d39e30081` |  |
| `src/repositories/exercise.prisma.ts#listRoutinesUsing#1` | query | uncategorized | needs review | — | `5de40a41148d` |  |
| `src/repositories/exercise.prisma.ts#findUsage#1` | query | uncategorized | needs review | — | `a9e4f33de622` |  |
| `src/repositories/exercise.prisma.ts#deleteExercise#1` | query | uncategorized | needs review | — | `fabaf40135a1` |  |
| `src/repositories/exercise.prisma.ts#listMuscleGroups#1` | query | uncategorized | needs review | — | `cb9e6396384e` |  |
| `src/repositories/exercise.prisma.ts#listEquipment#1` | query | uncategorized | needs review | — | `c08d7deb0c23` |  |

## src/repositories/hevy-import.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy-import.prisma.ts#loadContext#1` | query | uncategorized | needs review | — | `7ade0afab77b` |  |
| `src/repositories/hevy-import.prisma.ts#loadContext#2` | query | uncategorized | needs review | — | `ef233b629126` |  |
| `src/repositories/hevy-import.prisma.ts#findLinks#1` | query | uncategorized | needs review | — | `105af8c51bfd` |  |
| `src/repositories/hevy-import.prisma.ts#findCandidates#1` | query | uncategorized | needs review | — | `30ed94302812` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#1` | query | uncategorized | needs review | — | `4b1b775cf486` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#2` | query | uncategorized | needs review | — | `a801a35ceb4f` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#3` | query | uncategorized | needs review | — | `5cd821fdbcc2` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#4` | query | uncategorized | needs review | — | `d761ca32491b` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#5` | fragment | uncategorized | needs review | callers: src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6 | `49e02910e650` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#6` | query | uncategorized | needs review | — | `38ca2d091080` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#7` | query | uncategorized | needs review | — | `3fdfd019ad90` |  |
| `src/repositories/hevy-import.prisma.ts#writeImportedWorkout#8` | query | uncategorized | needs review | — | `9dfe4c2df356` |  |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#1` | query | uncategorized | needs review | — | `9c856ba4bcd8` |  |
| `src/repositories/hevy-import.prisma.ts#insertMatchedLink#2` | query | uncategorized | needs review | — | `19c3ab016ee6` |  |
| `src/repositories/hevy-import.prisma.ts#finishImport#1` | query | uncategorized | needs review | — | `de44c0c80114` |  |
| `src/repositories/hevy-import.prisma.ts#finishImport#2` | query | uncategorized | needs review | — | `01ae13c53433` |  |

## src/repositories/hevy.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/hevy.prisma.ts#readHevyMapping#1` | query | uncategorized | needs review | — | `5ec8b46ed44d` |  |
| `src/repositories/hevy.prisma.ts#readHevyMapping#2` | query | uncategorized | needs review | — | `c1a1af4dae06` |  |
| `src/repositories/hevy.prisma.ts#lockUser#1` | query | uncategorized | needs review | — | `c2033235523f` |  |
| `src/repositories/hevy.prisma.ts#visibleExercises#1` | query | uncategorized | needs review | — | `5571c03dc370` |  |
| `src/repositories/hevy.prisma.ts#insertPairs#1` | query | uncategorized | needs review | — | `02975ccbe91d` |  |
| `src/repositories/hevy.prisma.ts#settleExportAs#1` | query | uncategorized | needs review | — | `9c2a707efc05` |  |
| `src/repositories/hevy.prisma.ts#settleExportAs#2` | query | uncategorized | needs review | — | `dcd0c1a325ba` |  |
| `src/repositories/hevy.prisma.ts#settleExportAs#3` | query | uncategorized | needs review | — | `9fffe8f601ab` |  |
| `src/repositories/hevy.prisma.ts#settleExportAs#4` | query | uncategorized | needs review | — | `7c1d64caeb74` |  |
| `src/repositories/hevy.prisma.ts#linkRow#1` | query | uncategorized | needs review | — | `17276bdcb8d7` |  |
| `src/repositories/hevy.prisma.ts#linkRow#2` | query | uncategorized | needs review | — | `e22a6ce1800b` |  |
| `src/repositories/hevy.prisma.ts#status#1` | query | uncategorized | needs review | — | `ddad2662b3f6` |  |
| `src/repositories/hevy.prisma.ts#replaceMapping#1` | query | uncategorized | needs review | — | `4be6c59decce` |  |
| `src/repositories/hevy.prisma.ts#replaceMapping#2` | query | uncategorized | needs review | — | `56962a887b6e` |  |
| `src/repositories/hevy.prisma.ts#replaceMapping#3` | query | uncategorized | needs review | — | `20898922bb61` |  |
| `src/repositories/hevy.prisma.ts#patchMapping#1` | query | uncategorized | needs review | — | `17b0850c62ac` |  |
| `src/repositories/hevy.prisma.ts#patchMapping#2` | query | uncategorized | needs review | — | `c11765251a39` |  |
| `src/repositories/hevy.prisma.ts#beginLink#1` | query | uncategorized | needs review | — | `1adc1c85771e` |  |
| `src/repositories/hevy.prisma.ts#beginLink#2` | query | uncategorized | needs review | — | `2eefcfd42280` |  |
| `src/repositories/hevy.prisma.ts#beginLink#3` | query | uncategorized | needs review | — | `21e46fb0e239` |  |
| `src/repositories/hevy.prisma.ts#beginLink#4` | query | uncategorized | needs review | — | `6927d8caff33` |  |
| `src/repositories/hevy.prisma.ts#completeLink#1` | query | uncategorized | needs review | — | `9c856ba4bcd8` |  |
| `src/repositories/hevy.prisma.ts#completeLink#2` | query | uncategorized | needs review | — | `0ea914bdcf40` |  |
| `src/repositories/hevy.prisma.ts#completeLink#3` | query | uncategorized | needs review | — | `94af6de17a6c` |  |
| `src/repositories/hevy.prisma.ts#releaseLink#1` | query | uncategorized | needs review | — | `9c856ba4bcd8` |  |
| `src/repositories/hevy.prisma.ts#releaseLink#2` | query | uncategorized | needs review | — | `b0442de28d4d` |  |
| `src/repositories/hevy.prisma.ts#releaseLink#3` | query | uncategorized | needs review | — | `2805bee28368` |  |

## src/repositories/ownership.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/ownership.ts#ownedWorkoutExercise#1` | fragment | uncategorized | needs review | callers: src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1 | `7e3c56f9e254` |  |
| `src/repositories/ownership.ts#ownedSet#1` | fragment | uncategorized | needs review | callers: src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2, src/repositories/set-entry.prisma.ts#deleteSet#1, src/repositories/set-entry.prisma.ts#deleteSet#2, src/repositories/set-entry.prisma.ts#deleteSet#3 | `714590bf093e` |  |
| `src/repositories/ownership.ts#ownedPlannedSet#1` | fragment | uncategorized | needs review | callers: none | `2bfd25df096f` |  |
| `src/repositories/ownership.ts#ownedWorkoutSection#1` | fragment | uncategorized | needs review | callers: none | `1a0304d4252a` |  |
| `src/repositories/ownership.ts#ownedSectionRound#1` | fragment | uncategorized | needs review | callers: none | `1a0304d4252a` |  |
| `src/repositories/ownership.ts#ownedRoutineItem#1` | fragment | uncategorized | needs review | callers: none | `2ef3600b3bd9` |  |
| `src/repositories/ownership.ts#ownedRoutineItemSet#1` | fragment | uncategorized | needs review | callers: none | `8832281cf14d` |  |
| `src/repositories/ownership.ts#ownedRoutineSection#1` | fragment | uncategorized | needs review | callers: none | `333253fff283` |  |

## src/repositories/personal-record.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/personal-record.prisma.ts#lockUserRecords#1` | query | uncategorized | needs review | — | `7cc51da9df99` |  |
| `src/repositories/personal-record.prisma.ts#rootsForWorkout#1` | query | uncategorized | needs review | — | `e2b84e41d226` |  |
| `src/repositories/personal-record.prisma.ts#rootOfWorkoutExercise#1` | query | uncategorized | needs review | — | `2c3c957fc83d` |  |
| `src/repositories/personal-record.prisma.ts#repeatedRootOfWorkoutExercise#1` | query | uncategorized | needs review | — | `8a66ecef61b3` |  |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#1` | fragment | uncategorized | needs review | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `56637d7e5e7e` |  |
| `src/repositories/personal-record.prisma.ts#lineageRangeSql#2` | fragment | uncategorized | needs review | callers: src/repositories/personal-record.prisma.ts#loadLineageSets#1 | `4b8608eb7053` |  |
| `src/repositories/personal-record.prisma.ts#resolveVisibleRoot#1` | query | uncategorized | needs review | — | `42f92ae7ff68` |  |
| `src/repositories/personal-record.prisma.ts#loadLineageSets#1` | query | uncategorized | needs review | — | `b9b8d90eac52` |  |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#1` | query | uncategorized | needs review | — | `2420fd4a10fd` |  |
| `src/repositories/personal-record.prisma.ts#recomputeRecordsForRoots#2` | query | uncategorized | needs review | — | `6b28ea11dcfc` |  |
| `src/repositories/personal-record.prisma.ts#list#1` | query | uncategorized | needs review | — | `7a2084cc6bca` |  |

## src/repositories/planned-sets.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/planned-sets.ts#plannedSetsJson#1` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1 | `e11e50226d59` |  |

## src/repositories/routine-one-off.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine-one-off.prisma.ts#sweepExpiredOneOffs#1` | query | uncategorized | needs review | — | `4faaa9529e2d` |  |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#1` | query | uncategorized | needs review | — | `6b268fac919a` |  |
| `src/repositories/routine-one-off.prisma.ts#deleteExpiredOneOffs#2` | query | uncategorized | needs review | — | `bb11ebf7f5d4` |  |
| `src/repositories/routine-one-off.prisma.ts#lockOneOffForFinish#1` | query | uncategorized | needs review | — | `db9f479d25af` |  |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#1` | query | uncategorized | needs review | — | `2fe74f00f5dd` |  |
| `src/repositories/routine-one-off.prisma.ts#settleOneOff#2` | query | uncategorized | needs review | — | `00dae8f9e639` |  |

## src/repositories/routine.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/routine.prisma.ts#ITEM_COLS#1` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#insertItems#2 | `0dfc438f2335` |  |
| `src/repositories/routine.prisma.ts#ROUTINE_WITH_ITEMS#1` | fragment | uncategorized | needs review | callers: src/repositories/account-export.prisma.ts#snapshot#4, src/repositories/routine.prisma.ts#loadOne#1, src/repositories/routine.prisma.ts#list#1 | `32652e61c01d` |  |
| `src/repositories/routine.prisma.ts#ROUTINE_ONE_OFF_ORDER#1` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#list#1 | `c7a788483a58` |  |
| `src/repositories/routine.prisma.ts#assertItemExercisesUsable#1` | query | uncategorized | needs review | — | `910f331c4de4` |  |
| `src/repositories/routine.prisma.ts#insertSections#1` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#insertSections#2 | `4c298fb6d337` |  |
| `src/repositories/routine.prisma.ts#insertSections#2` | query | uncategorized | needs review | — | `64e3429a4529` |  |
| `src/repositories/routine.prisma.ts#insertItems#1` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#insertItems#2 | `d8112dfacad7` |  |
| `src/repositories/routine.prisma.ts#insertItems#2` | query | uncategorized | needs review | — | `a69115ce9816` |  |
| `src/repositories/routine.prisma.ts#insertItems#3` | fragment | uncategorized | needs review | callers: src/repositories/routine.prisma.ts#insertItems#4 | `c782c5c187a9` |  |
| `src/repositories/routine.prisma.ts#insertItems#4` | query | uncategorized | needs review | — | `d723d1f22c3d` |  |
| `src/repositories/routine.prisma.ts#loadOne#1` | query | uncategorized | needs review | — | `aa2fe47d63ee` |  |
| `src/repositories/routine.prisma.ts#list#1` | query | uncategorized | needs review | — | `ca9f8e107446` |  |
| `src/repositories/routine.prisma.ts#create#1` | query | uncategorized | needs review | — | `4e5edf8359fa` |  |
| `src/repositories/routine.prisma.ts#create#2` | query | uncategorized | needs review | — | `6c6cd461567e` |  |
| `src/repositories/routine.prisma.ts#create#3` | query | uncategorized | needs review | — | `e877dcea99ec` |  |
| `src/repositories/routine.prisma.ts#replace#1` | query | uncategorized | needs review | — | `1e9864e2ad4c` |  |
| `src/repositories/routine.prisma.ts#replace#2` | query | uncategorized | needs review | — | `01e5a135e24d` |  |
| `src/repositories/routine.prisma.ts#replace#3` | query | uncategorized | needs review | — | `7262f99ce859` |  |
| `src/repositories/routine.prisma.ts#replace#4` | query | uncategorized | needs review | — | `d26eb157535d` |  |
| `src/repositories/routine.prisma.ts#keep#1` | query | uncategorized | needs review | — | `dcb9da2b5ad9` |  |
| `src/repositories/routine.prisma.ts#delete#1` | query | uncategorized | needs review | — | `d8dfcb723516` |  |

## src/repositories/section-timer-columns.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/section-timer-columns.ts#timedFieldsJson#1` | fragment | uncategorized | needs review | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2, src/repositories/workout.prisma.ts#workoutSectionsJson#1 | `6468b05507ac` |  |
| `src/repositories/section-timer-columns.ts#roundTimesJson#1` | fragment | uncategorized | needs review | callers: src/repositories/section-timer-columns.ts#timedFieldsJson#1, src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1 | `f3f6d420baca` |  |

## src/repositories/set-entry.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/set-entry.prisma.ts#SET_ENTRY_COLUMNS#1` | fragment | uncategorized | needs review | callers: src/repositories/account-export.prisma.ts#snapshot#7, src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1, src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1, src/repositories/set-entry.prisma.ts#createSet#5, src/repositories/set-entry.prisma.ts#updateSet#1, src/repositories/set-entry.prisma.ts#updateSet#2 | `adaaabb81498` |  |
| `src/repositories/set-entry.prisma.ts#resolveOwnedSet#1` | query | uncategorized | needs review | — | `045992f3e63a` |  |
| `src/repositories/set-entry.prisma.ts#findSetByClientGeneratedId#1` | query | uncategorized | needs review | — | `660b0cf382ac` |  |
| `src/repositories/set-entry.prisma.ts#lockedWorkoutSpan#1` | query | uncategorized | needs review | — | `4159706d3416` |  |
| `src/repositories/set-entry.prisma.ts#loadSetsForWorkout#1` | query | uncategorized | needs review | — | `915613309fd7` |  |
| `src/repositories/set-entry.prisma.ts#assertWouldNotEmpty#1` | query | uncategorized | needs review | — | `165006109380` |  |
| `src/repositories/set-entry.prisma.ts#assertWorkingSetsComplete#1` | query | uncategorized | needs review | — | `b868941c9eee` |  |
| `src/repositories/set-entry.prisma.ts#createSet#1` | query | uncategorized | needs review | — | `f09f975ad826` |  |
| `src/repositories/set-entry.prisma.ts#createSet#2` | query | uncategorized | needs review | — | `4e5edf8359fa` |  |
| `src/repositories/set-entry.prisma.ts#createSet#3` | query | uncategorized | needs review | — | `43f44ed194a8` |  |
| `src/repositories/set-entry.prisma.ts#createSet#4` | query | uncategorized | needs review | — | `95a70998a0c6` |  |
| `src/repositories/set-entry.prisma.ts#createSet#5` | query | uncategorized | needs review | — | `dd58361a485d` |  |
| `src/repositories/set-entry.prisma.ts#updateSet#1` | query | uncategorized | needs review | — | `4dbd6e9794f8` |  |
| `src/repositories/set-entry.prisma.ts#updateSet#2` | query | uncategorized | needs review | — | `d4801cf82b39` |  |
| `src/repositories/set-entry.prisma.ts#deleteSet#1` | query | uncategorized | needs review | — | `6cea45ab3f27` |  |
| `src/repositories/set-entry.prisma.ts#deleteSet#2` | query | uncategorized | needs review | — | `cc9fe2cfdadb` |  |
| `src/repositories/set-entry.prisma.ts#deleteSet#3` | query | uncategorized | needs review | — | `763793d7909c` |  |

## src/repositories/user.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/user.prisma.ts#provision#1` | query | uncategorized | needs review | — | `2295a1d80413` |  |
| `src/repositories/user.prisma.ts#markDeleted#1` | query | uncategorized | needs review | — | `d8f4f4fd405f` |  |

## src/repositories/workout-history.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#1` | fragment | uncategorized | needs review | callers: src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2 | `6d1557133124` |  |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#2` | query | uncategorized | needs review | — | `94395644ab77` |  |
| `src/repositories/workout-history.prisma.ts#listFinishedWorkouts#3` | query | uncategorized | needs review | — | `9e0a4df1003a` |  |

## src/repositories/workout-retime.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-retime.prisma.ts#userTimezone#1` | query | uncategorized | needs review | — | `4387b45c584d` |  |
| `src/repositories/workout-retime.prisma.ts#shiftSetTimes#1` | query | uncategorized | needs review | — | `1602fa550862` |  |
| `src/repositories/workout-retime.prisma.ts#clampSetTimes#1` | query | uncategorized | needs review | — | `475a63eef2b5` |  |

## src/repositories/workout-section.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#1` | query | uncategorized | needs review | — | `ec3bc3b7c83d` |  |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#2` | query | uncategorized | needs review | — | `4e5edf8359fa` |  |
| `src/repositories/workout-section.prisma.ts#lockWorkoutStructure#3` | query | uncategorized | needs review | — | `383433784a9b` |  |
| `src/repositories/workout-section.prisma.ts#workoutPreflight#1` | query | uncategorized | needs review | — | `ded271a424c4` |  |
| `src/repositories/workout-section.prisma.ts#exerciseRanks#1` | query | uncategorized | needs review | — | `8969e27201cc` |  |
| `src/repositories/workout-section.prisma.ts#SECTION_COLUMNS#1` | fragment | uncategorized | needs review | callers: src/repositories/workout-section.prisma.ts#lockSectionThenRead#1, src/repositories/workout-section.prisma.ts#addWorkoutSection#2, src/repositories/workout-section.prisma.ts#updateWorkoutSection#2, src/repositories/workout-section.prisma.ts#setSectionResult#1 | `a23ad810b455` |  |
| `src/repositories/workout-section.prisma.ts#lockWorkoutForRecord#1` | query | uncategorized | needs review | — | `383433784a9b` |  |
| `src/repositories/workout-section.prisma.ts#lockSectionRow#1` | query | uncategorized | needs review | — | `e73b8f7cc778` |  |
| `src/repositories/workout-section.prisma.ts#lockSectionThenRead#1` | query | uncategorized | needs review | — | `98b058d9b36d` |  |
| `src/repositories/workout-section.prisma.ts#sectionPreflight#1` | query | uncategorized | needs review | — | `9d62aab4da0b` |  |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#1` | query | uncategorized | needs review | — | `d43f261e49a0` |  |
| `src/repositories/workout-section.prisma.ts#addWorkoutSection#2` | query | uncategorized | needs review | — | `b54276b3d628` |  |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#1` | query | uncategorized | needs review | — | `cf6791aa223e` |  |
| `src/repositories/workout-section.prisma.ts#updateWorkoutSection#2` | query | uncategorized | needs review | — | `2045550b895e` |  |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#1` | query | uncategorized | needs review | — | `bb8c4ce0dd9f` |  |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#2` | query | uncategorized | needs review | — | `a97e8278fad5` |  |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#3` | query | uncategorized | needs review | — | `0742b3d5b649` |  |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#4` | query | uncategorized | needs review | — | `cae68b97f60d` |  |
| `src/repositories/workout-section.prisma.ts#removeWorkoutSection#5` | query | uncategorized | needs review | — | `bc35bdc3e321` |  |
| `src/repositories/workout-section.prisma.ts#setSectionRoundTime#1` | query | uncategorized | needs review | — | `af94b307b3c4` |  |
| `src/repositories/workout-section.prisma.ts#clearSectionRoundTime#1` | query | uncategorized | needs review | — | `f37b593169c4` |  |
| `src/repositories/workout-section.prisma.ts#setSectionResult#1` | query | uncategorized | needs review | — | `888cfd01e35a` |  |
| `src/repositories/workout-section.prisma.ts#clearSectionResult#1` | query | uncategorized | needs review | — | `41019e8aca35` |  |

## src/repositories/workout.prisma.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/repositories/workout.prisma.ts#workoutSectionsJson#1` | fragment | uncategorized | needs review | callers: src/repositories/account-export.prisma.ts#snapshot#5, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `8a436a3f4a1b` |  |
| `src/repositories/workout.prisma.ts#routineIsOneOffSql#1` | fragment | uncategorized | needs review | callers: src/repositories/account-export.prisma.ts#snapshot#5, src/repositories/workout.prisma.ts#loadSectionSnapshot#1 | `89946946892d` |  |
| `src/repositories/workout.prisma.ts#finishedPatch#1` | query | uncategorized | needs review | — | `fcec8810aef6` |  |
| `src/repositories/workout.prisma.ts#loadExercises#1` | query | uncategorized | needs review | — | `0fad4267bd4d` |  |
| `src/repositories/workout.prisma.ts#loadSectionSnapshot#1` | query | uncategorized | needs review | — | `ba32f99404f7` |  |
| `src/repositories/workout.prisma.ts#readWorkoutDetail#1` | query | uncategorized | needs review | — | `f770297448fc` |  |
| `src/repositories/workout.prisma.ts#countExercises#1` | query | uncategorized | needs review | — | `3db15f3e1c79` |  |
| `src/repositories/workout.prisma.ts#countAndLastSection#1` | query | uncategorized | needs review | — | `f77bca7afcdd` |  |
| `src/repositories/workout.prisma.ts#tryInsert#1` | query | uncategorized | needs review | — | `d55f7006991a` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#1` | query | uncategorized | needs review | — | `59da7b81a35d` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#2` | query | uncategorized | needs review | — | `02c90d0ee0ff` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#3` | query | uncategorized | needs review | — | `bebc86e1d38a` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#4` | fragment | uncategorized | needs review | callers: src/repositories/workout.prisma.ts#insertFromRoutine#5 | `40bad70e016d` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#5` | query | uncategorized | needs review | — | `7df3528437b6` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#6` | query | uncategorized | needs review | — | `32f8a07782b5` |  |
| `src/repositories/workout.prisma.ts#insertFromRoutine#7` | query | uncategorized | needs review | — | `a16e3ed2ea52` |  |
| `src/repositories/workout.prisma.ts#findByClientGeneratedId#1` | query | uncategorized | needs review | — | `5299e0e839b6` |  |
| `src/repositories/workout.prisma.ts#getActiveWorkout#1` | query | uncategorized | needs review | — | `de94af128bbd` |  |
| `src/repositories/workout.prisma.ts#updateWorkout#1` | query | uncategorized | needs review | — | `29f51b27f004` |  |
| `src/repositories/workout.prisma.ts#updateWorkout#2` | query | uncategorized | needs review | — | `bfcef0703916` |  |
| `src/repositories/workout.prisma.ts#deleteWorkout#1` | query | uncategorized | needs review | — | `ee61915a23c7` |  |
| `src/repositories/workout.prisma.ts#deleteWorkout#2` | query | uncategorized | needs review | — | `b0442de28d4d` |  |
| `src/repositories/workout.prisma.ts#deleteWorkout#3` | query | uncategorized | needs review | — | `1a31ed921a35` |  |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#1` | query | uncategorized | needs review | — | `f390beb56ea7` |  |
| `src/repositories/workout.prisma.ts#addWorkoutExercise#2` | query | uncategorized | needs review | — | `2a91f8f8dc1b` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#1` | query | uncategorized | needs review | — | `f606f46b7de3` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#2` | query | uncategorized | needs review | — | `abff81183eca` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#3` | query | uncategorized | needs review | — | `6e9ed8d47690` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#4` | query | uncategorized | needs review | — | `6793ac30e460` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#5` | query | uncategorized | needs review | — | `acbd7796c1c3` |  |
| `src/repositories/workout.prisma.ts#updateWorkoutExercise#6` | query | uncategorized | needs review | — | `2dfa87b3bb6c` |  |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#1` | query | uncategorized | needs review | — | `dab0c88e02cf` |  |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#2` | query | uncategorized | needs review | — | `b54698eb10f7` |  |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#3` | query | uncategorized | needs review | — | `f8dbb736d3a3` |  |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#4` | query | uncategorized | needs review | — | `f4b61ebfaf96` |  |
| `src/repositories/workout.prisma.ts#deleteWorkoutExercise#5` | query | uncategorized | needs review | — | `a1e24450e01e` |  |

## src/seed/catalog.ts

| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |
|---|---|---|---|---|---|---|
| `src/seed/catalog.ts#upsertReference#1` | fragment | uncategorized | needs review | callers: src/seed/catalog.ts#upsertReference#2, src/seed/catalog.ts#upsertReference#3 | `15c5e748338b` |  |
| `src/seed/catalog.ts#upsertReference#2` | query | uncategorized | needs review | — | `54c82c2ab712` |  |
| `src/seed/catalog.ts#upsertReference#3` | query | uncategorized | needs review | — | `52f3dc6c0351` |  |
| `src/seed/catalog.ts#seedCatalog#1` | query | uncategorized | needs review | — | `ebd28726c6c4` |  |
| `src/seed/catalog.ts#seedCatalog#2` | query | uncategorized | needs review | — | `f579901c14c5` |  |
| `src/seed/catalog.ts#seedCatalog#3` | query | uncategorized | needs review | — | `3db93d63cacd` |  |
| `src/seed/catalog.ts#seedCatalog#4` | query | uncategorized | needs review | — | `e095c76cde53` |  |
| `src/seed/catalog.ts#seedCatalog#5` | query | uncategorized | needs review | — | `9925eeb15ace` |  |
| `src/seed/catalog.ts#seedCatalog#6` | query | uncategorized | needs review | — | `20da42d7bf2f` |  |
