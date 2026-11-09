// apps/api/src/db/rls.ts
import type { PrismaClient } from "@prisma/client";
import { RLS_LOCK_ORDER, RLS_TABLES, quoteIdent } from "./rls-tables.js";

export interface RlsTableStatus {
  table: string;
  enabled: boolean;
}

export type RlsCatalogClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Spec 21.1 AC39 — whether row-level security is on, per table, in `RLS_TABLES` order. Reading `pg_class` needs no
 * privilege, so this runs on either login. A table the catalog does not list (a database behind on its migrations) reads off.
 */
export async function rlsStatus(client: RlsCatalogClient): Promise<RlsTableStatus[]> {
  const rows = await client.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname = ANY(${[...RLS_TABLES]}::text[])`;
  const on = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
  return RLS_TABLES.map((table) => ({ table, enabled: on.get(table) === true }));
}

/**
 * Spec 21.1 D12 — the kill switch: every table or none, in one transaction, on the owner login. A command rather than a
 * migration, so it is instant and reversible, and `migrate deploy` never sees it. The locks are taken up front in the
 * API's write order with a 5 s timeout (as in `0021`), so a busy table fails the command cleanly instead of hanging an
 * incident; run it again. No `FORCE` in either direction (D6).
 */
export async function setRls(owner: PrismaClient, on: boolean): Promise<void> {
  const action = on ? "ENABLE" : "DISABLE";
  await owner.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      await tx.$executeRawUnsafe(`LOCK TABLE ${RLS_LOCK_ORDER.map(quoteIdent).join(", ")} IN ACCESS EXCLUSIVE MODE`);
      for (const table of RLS_TABLES) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${quoteIdent(table)} ${action} ROW LEVEL SECURITY`);
      }
    },
    { timeout: 15_000 },
  );
}

/**
 * Spec 21.1 Review Focus 4 — the boot check does not care whether RLS is on (D5), and `migrate deploy` will not run `0021`
 * again, so a kill switch left off after an incident would otherwise be silent. A failed read costs only the warning: the
 * API must still start. The error is not logged, because a connection error's message names the host.
 */
export async function warnIfRlsDisabled(
  client: RlsCatalogClient,
  logger: { warn(data: object, msg: string): void },
): Promise<void> {
  let status: RlsTableStatus[];
  try {
    status = await rlsStatus(client);
  } catch {
    logger.warn({}, "rls_status_unavailable");
    return;
  }
  const tables = status.filter((s) => !s.enabled).map((s) => s.table);
  if (tables.length > 0) logger.warn({ tables }, "rls_disabled");
}
