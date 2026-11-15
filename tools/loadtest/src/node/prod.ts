/**
 * Spec 16 AC27 — the `prod` target's guards, and its base URL from `infra/prod.tfvars` through Spec 15's
 * `prod-ids.mjs` (the one module that derives production origins, Spec 15 AC24).
 */
import { placeholderIds, prodOrigins } from "../../../../apps/web/scripts/lib/prod-ids.mjs";
import { PROD_MAX_REQUESTS } from "../plan/constants.ts";
import type { RunCommand } from "./args.ts";

export function prodBaseUrl(tfvarsText: string): string {
  if (placeholderIds(tfvarsText).length > 0) {
    throw new Error(
      "infra/prod.tfvars still has placeholders (REPLACE_ME_…); production isn't set up yet — runbook first-deploy.md Part F",
    );
  }
  return prodOrigins(tfvarsText).apiOrigin;
}

/** Why a run may not start on prod, or `undefined` when it may (and for every other target). */
export function checkProdGuards(cmd: RunCommand, estimate: number): string | undefined {
  if (cmd.target !== "prod") return undefined;
  if (!cmd.confirmProd) return "prod runs need --confirm-prod";
  if (cmd.type === "push" && !cmd.confirmProdPush) return "a push run on prod also needs --confirm-prod-push";
  if (estimate > PROD_MAX_REQUESTS) {
    return `estimated ${estimate} requests is over PROD_MAX_REQUESTS (${PROD_MAX_REQUESTS}); shorten the run`;
  }
  return undefined;
}
