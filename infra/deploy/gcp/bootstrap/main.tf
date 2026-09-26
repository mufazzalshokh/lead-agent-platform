locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])

  deployer_project_roles = toset([
    "roles/artifactregistry.admin",
    "roles/cloudsql.admin",
    "roles/compute.networkAdmin",
    "roles/iam.serviceAccountAdmin",
    "roles/monitoring.alertPolicyEditor",
    "roles/monitoring.notificationChannelViewer",
    "roles/resourcemanager.projectIamAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
    "roles/servicenetworking.networksAdmin",
    "roles/serviceusage.serviceUsageConsumer",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  name                        = var.state_bucket_name
  project                     = var.project_id
  location                    = var.region
  force_destroy               = false
  public_access_prevention    = "enforced"
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 30
      with_state         = "ARCHIVED"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "lead-agent-staging-deploy"
  display_name = "Lead Agent staging deployment"
  description  = "GitHub OIDC deployment identity; no service-account key is permitted."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "deployer" {
  for_each = local.deployer_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_temporary_logging_viewer" {
  count = var.temporary_logging_viewer_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_storage_bucket_iam_member" "deployer_state" {
  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_billing_account_iam_member" "deployer_budget" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.costsManager"
  member             = "serviceAccount:${google_service_account.deployer.email}"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-staging"
  display_name              = "GitHub staging deployments"
  description               = "Trust boundary for the staging GitHub environment."
  disabled                  = false

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "lead-agent-main"
  display_name                       = "Lead Agent main/staging"
  description                        = "Only main deployments approved by the GitHub staging environment."

  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.environment"  = "assertion.environment"
    "attribute.ref"          = "assertion.ref"
    "attribute.repository"   = "assertion.repository"
    "attribute.workflow_ref" = "assertion.workflow_ref"
  }
  attribute_condition = <<-EOT
    assertion.repository == '${var.github_repository}' &&
    assertion.environment == 'staging' &&
    (assertion.ref == 'refs/heads/main' || assertion.ref == 'refs/heads/verify/s22-staging-recovery-capacity') &&
    (assertion.workflow_ref == '${var.github_repository}/.github/workflows/staging-images.yml@' + assertion.ref ||
     assertion.workflow_ref == '${var.github_repository}/.github/workflows/staging-terraform.yml@' + assertion.ref)
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
