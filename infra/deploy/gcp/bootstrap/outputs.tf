output "deployer_service_account" {
  description = "GitHub Actions service account used through WIF."
  value       = google_service_account.deployer.email
}

output "state_bucket_name" {
  description = "GCS backend bucket; bootstrap state must be migrated here after first apply."
  value       = google_storage_bucket.terraform_state.name
}

output "workload_identity_provider" {
  description = "Provider resource name for google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}
