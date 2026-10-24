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

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
