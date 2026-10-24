# Spec 15 AC5: compare these with prod.tfvars after the first apply (runbook Part F); the GitHub
# variables of spec §8 are filled from them.
output "api_origin" {
  description = "The deterministic Cloud Run origin (PROD_API_BASE_URL)."
  value       = "https://${var.service_name}-${var.project_number}.${var.region}.run.app"
}

output "api_urls" {
  description = "Every URL Cloud Run reports for the service; api_origin must be among them."
  value       = google_cloud_run_v2_service.api.urls
}

output "web_origin" {
  description = "The Firebase Hosting origin (PROD_WEB_BASE_URL, WEB_ORIGIN)."
  value       = google_firebase_hosting_site.web.default_url
}

output "wif_provider" {
  description = "GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "publisher_sa" {
  description = "GCP_PUBLISHER_SA."
  value       = google_service_account.publisher.email
}

output "deployer_sa" {
  description = "GCP_DEPLOYER_SA."
  value       = google_service_account.deployer.email
}

output "runtime_sa" {
  description = "The API's runtime service account."
  value       = google_service_account.runtime.email
}

output "ar_repository" {
  description = "AR_IMAGE is this plus /api."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
