# Spec 15 AC5: Firebase Hosting in the same project, with a fixed site id so the web origin is known
# before the first deploy (https://<site id>.web.app).
resource "google_firebase_project" "default" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.enabled]
}

resource "google_firebase_hosting_site" "web" {
  provider   = google-beta
  project    = var.project_id
  site_id    = var.hosting_site_id
  depends_on = [google_firebase_project.default]
}
