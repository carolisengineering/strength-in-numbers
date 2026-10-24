# Spec 15 AC5: the values live in prod.tfvars, the one committed source (no secrets).

variable "project_id" {
  type        = string
  description = "The Google Cloud project (created by hand, runbook Part F)."
}

variable "project_number" {
  type        = string
  description = "The project number; part of the deterministic Cloud Run origin."
}

variable "region" {
  type        = string
  description = "Region for Cloud Run and Artifact Registry."
}

variable "service_name" {
  type        = string
  description = "The Cloud Run service (si-api)."
}

variable "hosting_site_id" {
  type        = string
  description = "The Firebase Hosting site id; the web origin is https://<id>.web.app."
}

variable "auth0_domain" {
  type        = string
  description = "The Auth0 tenant domain (D7: the existing tenant)."
}

variable "auth0_issuer" {
  type        = string
  description = "AUTH0_ISSUER, as render.yaml's api-shared group."
}

variable "auth0_audience" {
  type        = string
  description = "AUTH0_AUDIENCE, as render.yaml's api-shared group."
}

variable "auth0_claim_namespace" {
  type        = string
  description = "AUTH0_CLAIM_NAMESPACE, as render.yaml's api-shared group."
}

variable "github_repository" {
  type        = string
  description = "owner/repo; the only repository the CI identity accepts."
}

variable "billing_account_id" {
  type        = string
  description = "The billing account the $1 budget watches."
}
