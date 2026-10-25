# Spec 15 AC6 / D15: keyless CI. GitHub's OIDC token is exchanged for short-lived credentials; only this
# repository is accepted. The publisher pushes images for main; the deployer deploys, only for jobs in
# the GitHub Environment `production` (which needs the owner's approval). No service-account keys.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  # The name alone could be re-created by someone else after a rename or delete; the numeric id cannot (#165).
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_id == '${var.github_repository_id}'"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    # Jobs without an environment (publish, the gate) carry no `environment` claim; a bare
    # reference would fail their token exchange (code review).
    "attribute.environment" = "has(assertion.environment) ? assertion.environment : ''"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  pool = google_iam_workload_identity_pool.github.name
}

resource "google_service_account" "publisher" {
  account_id   = "si-ci-publisher"
  display_name = "CI image publisher (main only)"
}

resource "google_service_account" "deployer" {
  account_id   = "si-ci-deployer"
  display_name = "CI production deployer (Environment production only)"
}

# Who may act as each account.
# The publisher trusts any run whose ref is main. A `pull_request_target`, `workflow_run` or `issue_comment`
# run carries main's ref while someone outside can start or steer it, so it would match this binding: workflows
# may trigger only on push, pull_request or workflow_dispatch (deploy-pins.test.ts fails otherwise, #166).
resource "google_service_account_iam_member" "publisher_from_main" {
  service_account_id = google_service_account.publisher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool}/attribute.ref/refs/heads/main"
}

resource "google_service_account_iam_member" "deployer_from_production" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool}/attribute.environment/production"
}

# What each account may do.
resource "google_artifact_registry_repository_iam_member" "publisher_writes_images" {
  repository = google_artifact_registry_repository.images.name
  location   = google_artifact_registry_repository.images.location
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.publisher.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_reads_images" {
  repository = google_artifact_registry_repository.images.name
  location   = google_artifact_registry_repository.images.location
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_updates_api" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_deploys_hosting" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# firebase-tools calls project APIs on the caller's quota; without this a keyless deploy is refused.
resource "google_project_iam_member" "deployer_uses_services" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
