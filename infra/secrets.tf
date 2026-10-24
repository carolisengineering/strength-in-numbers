# Spec 15 AC4 / D14: an empty container; its value is added by hand (gcloud secrets versions add), so no
# secret value is ever in a .tf file, a variable file or the state. No google_secret_manager_secret_version.
resource "google_secret_manager_secret" "database_url" {
  secret_id = "si-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "runtime_reads_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
