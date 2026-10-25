# Spec 15 AC5 / AC24 — the one committed source of production identifiers and origins. No secrets.
# Every other place that names a production origin (firebase.json's CSP, Terraform's WEB_ORIGIN, the
# runbook's variable table) must agree with these; apps/api/test/unit/prod-origins.test.ts checks it.
#
# PLACEHOLDERS: the REPLACE_ME_* values are filled once the owner creates the Google Cloud project
# (runbook Part F). `pnpm --filter @sin/api exec tsx scripts/check-prod-ids.ts --strict` fails until
# they are, and runbook Part F runs it before the first `terraform apply`; deploy-prod refuses too.

project_id      = "REPLACE_ME_PROJECT_ID"
project_number  = "REPLACE_ME_PROJECT_NUMBER"
region          = "us-central1"
service_name    = "si-api"
hosting_site_id = "REPLACE_ME_SITE_ID"

# Auth0: the existing tenant (D7). Public configuration, the same values as render.yaml's api-shared group.
auth0_domain          = "dev-gncuqvfir0wv0t4l.us.auth0.com"
auth0_issuer          = "https://dev-gncuqvfir0wv0t4l.us.auth0.com/"
auth0_audience        = "https://api.strengthinnumbers.app"
auth0_claim_namespace = "https://strengthinnumbers.app/"

github_repository    = "carolisengineering/strength-in-numbers"
github_repository_id = "1351697035" # gh api repos/carolisengineering/strength-in-numbers --jq .id
billing_account_id   = "REPLACE_ME_BILLING_ACCOUNT_ID"
