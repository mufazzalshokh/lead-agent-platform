locals {
  name_prefix = "lead-agent-${var.environment}"
  common_labels = {
    application = "lead-agent-platform"
    environment = var.environment
    managed-by  = "terraform"
  }
}

resource "google_compute_network" "staging" {
  name                    = "${local.name_prefix}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "cloud_run" {
  name                     = "${local.name_prefix}-cloud-run"
  project                  = var.project_id
  region                   = var.region
  network                  = google_compute_network.staging.id
  ip_cidr_range            = "10.22.0.0/24"
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_global_address" "private_services" {
  name          = "${local.name_prefix}-private-services"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.staging.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.staging.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "lead-agent"
  description   = "Immutable S22 staging OCI images"
  format        = "DOCKER"
  labels        = local.common_labels

  cleanup_policies {
    id     = "delete-untagged-after-30-days"
    action = "DELETE"
    condition {
      older_than = "2592000s"
      tag_state  = "UNTAGGED"
    }
  }
}

resource "google_sql_database_instance" "staging" {
  name                = "${local.name_prefix}-postgres17"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    tier                        = "db-custom-1-3840"
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 20
    disk_autoresize             = true
    disk_autoresize_limit       = 50
    deletion_protection_enabled = true
    user_labels                 = local.common_labels

    backup_configuration {
      enabled                        = true
      start_time                     = "01:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.staging.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 2
      update_track = "stable"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "application" {
  name      = "lead_agent_staging"
  project   = var.project_id
  instance  = google_sql_database_instance.staging.name
  charset   = "UTF8"
  collation = "en_US.UTF8"
}
