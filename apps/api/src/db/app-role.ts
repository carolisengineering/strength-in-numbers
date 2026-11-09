// apps/api/src/db/app-role.ts
import type { PrismaClient } from "@prisma/client";

/**
 * Spec 21.1 AC29 — the restricted application login `sin_app` (§6.5). Migration `0020` creates the role `NOLOGIN`;
 * this gives it a login and a password and reads back what the role can do. On Neon the role must come from SQL, not
 * the Console: Console roles are members of `neon_superuser`, which bypasses row-level security.
 */

export const APP_ROLE = "sin_app";

export interface AppRoleReport {
  rolname: string;
  canLogin: boolean;
  superuser: boolean;
  bypassrls: boolean;
  createRole: boolean;
  createDb: boolean;
  /** Roles `sin_app` is a member of. Never the roles that are members of `sin_app` (Review Focus 1). */
  memberOf: string[];
}

/** A login, nothing else: no superuser, no BYPASSRLS, no role or database creation, no membership to borrow from. */
export function appRoleIsClean(r: AppRoleReport): boolean {
  return r.canLogin && !r.superuser && !r.bypassrls && !r.createRole && !r.createDb && r.memberOf.length === 0;
}

/** What is wrong with a report, one phrase per problem (empty when clean). */
export function appRoleProblems(r: AppRoleReport): string[] {
  const problems: string[] = [];
  if (!r.canLogin) problems.push("cannot log in");
  if (r.superuser) problems.push("is a superuser");
  if (r.bypassrls) problems.push("has BYPASSRLS");
  if (r.createRole) problems.push("has CREATEROLE");
  if (r.createDb) problems.push("has CREATEDB");
  for (const role of r.memberOf) problems.push(`is a member of ${role}`);
  return problems;
}

type RawTx = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

interface RoleRow {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
}

/** The role's flags and memberships, or `null` when it does not exist. */
export async function readAppRoleReport(client: RawTx): Promise<AppRoleReport | null> {
  const rows = await client.$queryRaw<RoleRow[]>`
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'sin_app'`;
  const role = rows[0];
  if (!role) return null;
  // Postgres 16 makes a CREATEROLE creator a member of the role it creates, WITH ADMIN OPTION: that row has sin_app as
  // the granted role. Only rows where sin_app is the MEMBER are privileges sin_app could use.
  const memberships = await client.$queryRaw<{ role: string }[]>`
    SELECT g.rolname AS role FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
    WHERE m.member = 'sin_app'::regrole ORDER BY 1`;
  return {
    rolname: role.rolname,
    canLogin: role.rolcanlogin,
    superuser: role.rolsuper,
    bypassrls: role.rolbypassrls,
    createRole: role.rolcreaterole,
    createDb: role.rolcreatedb,
    memberOf: memberships.map((m) => m.role),
  };
}

/**
 * Gives `sin_app` `LOGIN` and the password, then reads the role back, in one transaction. The password travels only as
 * a bound parameter into a transaction-local setting, and `format(… %L)` quotes it inside the database, so no SQL text
 * ever contains it and any quote, `$$` or backslash is set exactly (Review Focus 3).
 */
export async function setAppRoleLogin(owner: PrismaClient, password: string): Promise<AppRoleReport> {
  return owner.$transaction(async (tx) => {
    const exists = await tx.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM pg_roles WHERE rolname = 'sin_app'`;
    if (exists.length === 0) throw new Error("sin_app does not exist: run db:migrate:deploy first (migration 0020 creates it)");
    await tx.$queryRaw`SELECT set_config('sin.app_role_password', ${password}, true)`;
    await tx.$executeRaw`DO $$ BEGIN
      EXECUTE format('ALTER ROLE sin_app WITH LOGIN PASSWORD %L', current_setting('sin.app_role_password'));
    END $$`;
    await tx.$queryRaw`SELECT set_config('sin.app_role_password', '', true)`;
    return (await readAppRoleReport(tx))!;
  });
}
