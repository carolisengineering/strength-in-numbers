# Spec 15 AC2 and §6.1: the API on Cloud Run, scaling 0 to 1, public, its own runtime account.
resource "google_service_account" "runtime" {
  account_id   = "si-api-runtime"
  display_name = "si-api runtime"
}

resource "google_cloud_run_v2_service" "api" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 20
    timeout                          = "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      # D23: Google's sample, pinned by digest, until the first deploy-prod replaces it (ignored below).
      image = "us-docker.pkg.dev/cloudrun/container/hello@sha256:efd04605322d5d1ce6b1fd3dfc63a9c1fb2b99c97194ec316c0df0fd8f5dcf01"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # request-based billing
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AUTH0_ISSUER"
        value = var.auth0_issuer
      }
      env {
        name  = "AUTH0_AUDIENCE"
        value = var.auth0_audience
      }
      env {
        name  = "AUTH0_CLAIM_NAMESPACE"
        value = var.auth0_claim_namespace
      }
      env {
        name  = "WEB_ORIGIN"
        value = "https://${var.hosting_site_id}.web.app"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "CLIENT_IP_SOURCE"
        value = "cloud-run"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      # /healthz needs no database, so a Neon wake-up cannot fail the startup probe.
      startup_probe {
        period_seconds    = 2
        failure_threshold = 15
        http_get {
          path = "/healthz"
        }
      }
      liveness_probe {
        period_seconds = 30
        http_get {
          path = "/healthz"
        }
      }
    }
  }

  # The deploy workflow owns the image (by digest); Terraform never rolls it back.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret_iam_member.runtime_reads_database_url,
  ]
}

# The API is public by design: Auth0 JWTs and the rate limits protect it, as on Render.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
