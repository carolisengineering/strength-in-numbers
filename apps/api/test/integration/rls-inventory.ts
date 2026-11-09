// apps/api/test/integration/rls-inventory.ts
import type { PrismaClient } from "@prisma/client";
import { RLS_TABLES } from "../../src/db/rls-tables.js";
import { APP_GRANTS, OWNED_TABLES } from "./app-grants.js";

/** Never under RLS: `sin_app` holds no privilege on it. */
const EXEMPT = "_prisma_migrations";

/**
 * Spec 21.1 AC33 — one line per gap between the database and the three lists a table must be on: RLS enabled, a policy
 * for `sin_app`, an `APP_GRANTS` entry that matches what is granted. Empty means clean. There is no default privilege
 * (§4.3), so a new table is invisible to `sin_app` until its migration handles all of this; this makes forgetting a CI
 * failure rather than a route that returns nothing. It can't judge what a policy says, so a table with a `user_id` column
 * must also be on `OWNED_TABLES`: there the AC34 probe proves its policy, and a `USING (true)` fails.
 */
export async function rlsInventoryProblems(owner: PrismaClient): Promise<string[]> {
  const tables = await owner.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    ORDER BY c.relname`;
  const policies = await owner.$queryRaw<{ tablename: string }[]>`
    SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public' AND 'sin_app' = ANY(roles::text[])`;
  const grants = await owner.$queryRaw<{ table_name: string; privilege_type: string }[]>`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE grantee = 'sin_app' AND table_schema = 'public'`;
  const userColumns = await owner.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'`;

  const hasUserId = new Set(userColumns.map((c) => c.table_name));
  const probed: ReadonlySet<string> = new Set(OWNED_TABLES);
  const withPolicy = new Set(policies.map((p) => p.tablename));
  const granted = new Map<string, string[]>();
  for (const g of grants) granted.set(g.table_name, [...(granted.get(g.table_name) ?? []), g.privilege_type]);

  const problems: string[] = [];
  const present = new Set<string>();
  for (const { relname, relrowsecurity } of tables) {
    if (relname === EXEMPT) continue;
    present.add(relname);
    const line = (what: string) => problems.push(`table "${relname}": ${what}`);
    if (!relrowsecurity) line("RLS not enabled");
    if (!withPolicy.has(relname)) line("no policy for sin_app");
    if (!RLS_TABLES.includes(relname)) line("not in RLS_TABLES");
    if (hasUserId.has(relname) && !probed.has(relname)) line("has a user_id column but is not in OWNED_TABLES, so the AC34 probe skips it");
    const entry = APP_GRANTS[relname];
    if (entry === undefined) line("no entry in APP_GRANTS");
    else if ([...entry.table].sort().join() !== [...(granted.get(relname) ?? [])].sort().join()) line("sin_app's grants differ from APP_GRANTS");
  }
  for (const name of new Set([...RLS_TABLES, ...Object.keys(APP_GRANTS)])) {
    if (!present.has(name)) problems.push(`table "${name}": listed, but it does not exist`);
  }
  if (granted.has(EXEMPT)) problems.push(`table "${EXEMPT}": sin_app must hold no privilege on it`);
  return problems;
}
