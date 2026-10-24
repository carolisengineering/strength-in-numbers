# Spec 15 AC1: exact versions only; the lock file is committed. The state bucket is made by hand
# (runbook Part F) and passed at init: terraform init -backend-config="bucket=<state bucket>".
terraform {
  required_version = "1.17.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.8.1"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "8.8.1"
    }
  }

  backend "gcs" {
    prefix = "prod"
  }
}

# With the owner's user credentials (gcloud auth application-default login), the Billing Budgets API
# answers 403 unless calls are billed to a project (provider docs, google_billing_budget).
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
