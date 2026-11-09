// apps/api/scripts/lib/bench-login.ts
import { rlsStatus, type RlsCatalogClient } from "../../src/db/rls.js";
import { RLS_TABLES } from "../../src/db/rls-tables.js";

const APP_LOGIN = "sin_app";

export interface MeasuringAs {
  login: string;
  rlsTablesOn: number;
}

/**
 * Spec 21.1 AC37 — the owner skips row-level security, so a bench built on the owner client would report a reassuring
 * number that measures nothing. Each bench calls this on the client it measures with, once, before timing. A throw ends
 * the script with exit code 1.
 */
export async function assertMeasuringAsApp(client: RlsCatalogClient): Promise<MeasuringAs> {
  const [row] = await client.$queryRaw<{ login: string }[]>`SELECT current_user AS login`;
  const login = row?.login ?? "(unknown)";
  if (login !== APP_LOGIN) throw new Error(`this bench must measure as ${APP_LOGIN}, but it is connected as "${login}"`);
  const rlsTablesOn = (await rlsStatus(client)).filter((s) => s.enabled).length;
  if (rlsTablesOn !== RLS_TABLES.length) {
    throw new Error(`this bench must measure with RLS on, but only ${rlsTablesOn}/${RLS_TABLES.length} tables have it`);
  }
  return { login, rlsTablesOn };
}

export const benchLoginLine = (m: MeasuringAs): string => `login=${m.login} rls=${m.rlsTablesOn}/${RLS_TABLES.length}`;
