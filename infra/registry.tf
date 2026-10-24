# Spec 15 AC3 / D21: one Docker repository; keep the 5 most recent tagged images (the rollback window)
# and delete untagged ones after 7 days. A KEEP policy wins over a DELETE policy for the same version.
resource "google_artifact_registry_repository" "images" {
  location               = var.region
  repository_id          = "si"
  format                 = "DOCKER"
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-5-most-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-older-tagged"
    action = "DELETE"
    condition {
      tag_state = "TAGGED"
    }
  }

  cleanup_policies {
    id     = "delete-untagged-after-7-days"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }

  depends_on = [google_project_service.enabled]
}
