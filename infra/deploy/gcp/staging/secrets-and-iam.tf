locals {
  secret_ids = toset([
    "auth-browser-envelope-key",
    "auth-database-url",
    "auth0-client-secret",
    "customer-data-encryption-key",
    "customer-data-lookup-key",
    "gemini-api-key",
    "ingress-database-url",
    "instagram-app-secret",
    "instagram-webhook-verify-token",
    "invitation-target-encryption-key",
    "invitation-target-lookup-key",
    "migration-database-url",
    "queue-database-url",
    "runtime-database-url",
    "telegram-bot-token",
    "telegram-webhook-secret",
    "widget-exchange-encryption-key",
    "widget-signing-key",
  ])

  runtime_service_accounts = {
    api      = google_service_account.api.email
    migrator = google_service_account.migrator.email
    web      = google_service_account.web.email
    worker   = google_service_account.worker.email
  }

  api_secret_ids = toset([
    "auth-browser-envelope-key",
    "auth-database-url",
    "auth0-client-secret",
    "customer-data-encryption-key",
    "customer-data-lookup-key",
    "ingress-database-url",
    "instagram-app-secret",
    "instagram-webhook-verify-token",
    "invitation-target-encryption-key",
    "invitation-target-lookup-key",
    "runtime-database-url",
    "telegram-bot-token",
    "telegram-webhook-secret",
    "widget-exchange-encryption-key",
    "widget-signing-key",
  ])

  worker_secret_ids = toset([
    "customer-data-encryption-key",
    "customer-data-lookup-key",
    "gemini-api-key",
    "instagram-app-secret",
    "instagram-webhook-verify-token",
    "queue-database-url",
    "runtime-database-url",
    "telegram-bot-token",
    "telegram-webhook-secret",
  ])

  migrator_secret_ids = toset([
    "auth-database-url",
    "ingress-database-url",
    "migration-database-url",
    "queue-database-url",
    "runtime-database-url",
  ])
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.secret_ids

  project   = var.project_id
  secret_id = "${local.name_prefix}-${each.value}"
  labels    = local.common_labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret" "channel_credentials" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-channel-credentials"
  labels    = local.common_labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-api"
  display_name = "Lead Agent staging API"
}

resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-web"
  display_name = "Lead Agent staging Web"
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-worker"
  display_name = "Lead Agent staging worker"
}

resource "google_service_account" "migrator" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-migrator"
  display_name = "Lead Agent staging database migrator"
}

resource "google_project_iam_member" "runtime_logging" {
  for_each = local.runtime_service_accounts

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "runtime_metrics" {
  for_each = local.runtime_service_accounts

  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "database_clients" {
  for_each = toset([
    google_service_account.api.email,
    google_service_account.migrator.email,
    google_service_account.worker.email,
  ])

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

resource "google_secret_manager_secret_iam_member" "api_access" {
  for_each = local.api_secret_ids

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_access" {
  for_each = local.worker_secret_ids

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "migrator_access" {
  for_each = local.migrator_secret_ids

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrator.email}"
}

resource "google_secret_manager_secret_iam_member" "channel_credentials_read" {
  for_each = toset([google_service_account.api.email, google_service_account.worker.email])

  project   = var.project_id
  secret_id = google_secret_manager_secret.channel_credentials.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
}

resource "google_secret_manager_secret_iam_member" "channel_credentials_write" {
  for_each = toset([google_service_account.api.email, google_service_account.worker.email])

  project   = var.project_id
  secret_id = google_secret_manager_secret.channel_credentials.secret_id
  role      = "roles/secretmanager.secretVersionManager"
  member    = "serviceAccount:${each.value}"
}
