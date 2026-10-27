import type { PrismaClient } from "@prisma/client";
import type { HevyRepository, HevyStatusRecord } from "./hevy.js";

/**
 * Spec 19.0 §6: the Hevy mapping and links over raw SQL (the CHECK lists and partial unique indexes are the
 * migration's, `0016`). No advisory lock key (D16): mapping writes lock the user row, a begin locks the workout row.
 */
export function createHevyRepository(prisma: PrismaClient): HevyRepository {
  const notYet = (what: string) => async (): Promise<never> => {
    throw new Error(`HevyRepository.${what}: not implemented`);
  };

  return {
    async status(userId): Promise<HevyStatusRecord> {
      const rows = await prisma.$queryRaw<{ pairs: bigint; links: bigint; stale: boolean | null }[]>`
        SELECT
          (SELECT count(*) FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid) AS pairs,
          (SELECT count(*) FROM "hevy_link" WHERE user_id = ${userId}::uuid AND hevy_workout_id IS NOT NULL) AS links,
          (SELECT records_stale FROM "hevy_account" WHERE user_id = ${userId}::uuid) AS stale`;
      const row = rows[0]!;
      return { pairCount: Number(row.pairs), linkCount: Number(row.links), recordsStale: row.stale === true };
    },
    getMapping: notYet("getMapping"),
    replaceMapping: notYet("replaceMapping"),
    patchMapping: notYet("patchMapping"),
    readLink: notYet("readLink"),
    beginLink: notYet("beginLink"),
    completeLink: notYet("completeLink"),
    releaseLink: notYet("releaseLink"),
  };
}
