output "api_url" {
  description = "API run.app URL. Freeze this as api_public_origin before full runtime deployment."
  value       = var.deploy_runtime ? google_cloud_run_v2_service.api[0].uri : null
}

output "artifact_repository" {
  description = "Artifact Registry repository prefix."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "channel_credential_secret_resource" {
  description = "Managed writable credential secret resource; never a secret value."
  value       = google_secret_manager_secret.channel_credentials.id
}

output "cloud_sql_instance_connection_name" {
  description = "Cloud SQL connection name; the database remains private-IP only."
  value       = google_sql_database_instance.staging.connection_name
}

output "cloud_sql_private_ip" {
  description = "Private database address used only from the staging VPC."
  value       = google_sql_database_instance.staging.private_ip_address
}

output "cost_control_profile" {
  description = "Non-secret lifecycle/capacity settings active in this exact plan."
  value = {
    api_max_instances     = var.api_max_instance_count
    cloud_sql_policy      = var.cloud_sql_activation_policy
    cloud_sql_tier        = var.cloud_sql_tier
    web_max_instances     = var.web_max_instance_count
    worker_instance_count = var.worker_instance_count
    worker_memory         = var.worker_memory
  }
}

output "migrator_job_name" {
  description = "One-shot migration job name after full runtime deployment."
  value       = var.prepare_migration ? google_cloud_run_v2_job.migrator[0].name : null
}

output "secret_resources" {
  description = "Secret resource names whose values must be added through a secure owner/CI process."
  value       = { for key, secret in google_secret_manager_secret.runtime : key => secret.id }
}

output "web_url" {
  description = "Web run.app URL. Freeze this as web_public_origin before full runtime deployment."
  value       = var.deploy_runtime ? google_cloud_run_v2_service.web[0].uri : null
}
