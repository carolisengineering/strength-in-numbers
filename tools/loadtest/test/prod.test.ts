import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunCommand } from "../src/node/args.ts";
import { parseArgs } from "../src/node/args.ts";
import { checkProdGuards, prodBaseUrl } from "../src/node/prod.ts";
import { PROD_MAX_REQUESTS } from "../src/plan/constants.ts";

const base: RunCommand = { cmd: "run", type: "gym", target: "prod", dryRun: false, push: 1, allowUnpassedPush: false, metricsOutput: true };

describe("AC27 — prod guards", () => {
  it("the cap is 60,000 requests", () => {
    expect(PROD_MAX_REQUESTS).toBe(60_000);
  });

  it("a prod run needs --confirm-prod", () => {
    expect(checkProdGuards(base, 1000)).toBe("prod runs need --confirm-prod");
  });

  it("a push run on prod also needs --confirm-prod-push", () => {
    expect(checkProdGuards({ ...base, type: "push", push: 2, confirmProd: true }, 1000)).toBe("a push run on prod also needs --confirm-prod-push");
    expect(checkProdGuards({ ...base, type: "push", push: 2, confirmProd: true, confirmProdPush: true }, 1000)).toBeUndefined();
  });

  it("refuses an estimate over the cap", () => {
    expect(checkProdGuards({ ...base, confirmProd: true }, 60_001)).toBe(
      "estimated 60001 requests is over PROD_MAX_REQUESTS (60000); shorten the run",
    );
    expect(checkProdGuards({ ...base, confirmProd: true }, 60_000)).toBeUndefined();
  });

  it("a confirmed gym run under the cap may start", () => {
    expect(checkProdGuards({ ...base, confirmProd: true }, 12_785)).toBeUndefined();
  });

  it("staging and local have no prod guards", () => {
    expect(checkProdGuards({ ...base, target: "staging" }, 10_000_000)).toBeUndefined();
    expect(checkProdGuards({ ...base, target: "local", type: "push", push: 2 }, 10_000_000)).toBeUndefined();
  });

  it("parses --confirm-prod and --confirm-prod-push, and prod is no longer refused", () => {
    expect(parseArgs(["run", "gym", "--target", "prod", "--confirm-prod"])).toMatchObject({ target: "prod", confirmProd: true });
    expect(parseArgs(["run", "push", "--target", "prod", "--push", "2", "--confirm-prod", "--confirm-prod-push"])).toMatchObject({
      confirmProd: true,
      confirmProdPush: true,
    });
    expect(parseArgs(["run", "gym", "--target", "prod"])).not.toHaveProperty("confirmProd");
    expect(parseArgs(["cleanup", "--target", "prod"])).toEqual({ cmd: "cleanup", target: "prod" });
  });
});

describe("Review Focus 5 — the prod base URL comes from infra/prod.tfvars", () => {
  const tfvars = readFileSync(fileURLToPath(new URL("../../../infra/prod.tfvars", import.meta.url)), "utf8");

  it("refuses while prod.tfvars still holds placeholders, pointing at the runbook", () => {
    expect(() => prodBaseUrl(tfvars)).toThrow(
      "infra/prod.tfvars still has placeholders (REPLACE_ME_…); production isn't set up yet — runbook first-deploy.md Part F",
    );
  });

  it("returns the Cloud Run origin once it is filled in", () => {
    const filled = tfvars.replace(/"REPLACE_ME_PROJECT_NUMBER"/, '"123456789012"').replace(/"REPLACE_ME[A-Z_]*"/g, '"filled"');
    expect(prodBaseUrl(filled)).toBe("https://si-api-123456789012.us-central1.run.app");
  });
});
