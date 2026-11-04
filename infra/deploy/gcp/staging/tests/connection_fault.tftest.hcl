# Offline only: every Google operation is mocked; no credentials/backend/traffic.
mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_compute_network" {
    defaults = { id = "projects/lead-agent-stg-739284/global/networks/lead-agent-staging-vpc", self_link = "https://www.googleapis.com/compute/v1/projects/lead-agent-stg-739284/global/networks/lead-agent-staging-vpc" }
  }
  override_resource {
    override_during = plan
    target          = google_service_account.api
    values          = { email = "lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com", name = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com", id = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com", member = "serviceAccount:lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com", unique_id = "123456789001", deletion_policy = "PREVENT", disabled = false }
  }
  override_resource {
    override_during = plan
    target          = google_service_account.web
    values          = { email = "lead-agent-staging-web@lead-agent-stg-739284.iam.gserviceaccount.com", name = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-web@lead-agent-stg-739284.iam.gserviceaccount.com", id = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-web@lead-agent-stg-739284.iam.gserviceaccount.com", member = "serviceAccount:lead-agent-staging-web@lead-agent-stg-739284.iam.gserviceaccount.com", unique_id = "123456789002", deletion_policy = "PREVENT", disabled = false }
  }
  override_resource {
    override_during = plan
    target          = google_service_account.worker
    values          = { email = "lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com", name = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com", id = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com", member = "serviceAccount:lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com", unique_id = "123456789003", deletion_policy = "PREVENT", disabled = false }
  }
  override_resource {
    override_during = plan
    target          = google_service_account.migrator
    values          = { email = "lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com", name = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com", id = "projects/lead-agent-stg-739284/serviceAccounts/lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com", member = "serviceAccount:lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com", unique_id = "123456789004", deletion_policy = "PREVENT", disabled = false }
  }
}

variables {
  project_id                          = "lead-agent-stg-739284"
  billing_account_id                  = "AAAAAA-BBBBBB-CCCCCC"
  deployer_service_account_email      = "lead-agent-staging-deploy@lead-agent-stg-739284.iam.gserviceaccount.com"
  monitoring_notification_channel_ids = ["projects/lead-agent-stg-739284/notificationChannels/1"]
  deploy_runtime                      = true
  prepare_migration                   = true
  cloud_sql_activation_policy         = "ALWAYS"
  worker_instance_count               = 1
  git_commit_sha                      = "abc3071fb81777068f5adfb98f6144d9081077eb"
  deployment_timestamp                = "2026-10-11T20:27:12Z"
  migration_head                      = "0032_s22_widget_recovery"
  runtime_migration_head              = "0032_s22_widget_recovery"
  api_migration_head                  = "0032_s22_widget_recovery"
  api_git_commit_sha                  = "7a4201c824be3db2396b51c14d62e6758f43e860"
  api_deployment_timestamp            = "2026-10-31T18:20:23Z"
  migrator_git_commit_sha             = "abc3071fb81777068f5adfb98f6144d9081077eb"
  migrator_deployment_timestamp       = "2026-10-11T20:27:12Z"
  api_image                           = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:624e2d17ca48394af37bd70ac305e9b3104712afe25c83b3f3e2449711e2e2b9"
  web_image                           = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:4a57a0d4d80caa0eab3c0efb824aa1f97e33bb7f9d163b31fac129561e8f6dfe"
  worker_image                        = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:b6d550af4f2c071f00b7ae8388dddd7d8ef7efc3be8923aebd5c168140f75c5a"
  migrator_image                      = "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:223f1cb22f12a082c147c001d12690c491ca01cf63aa265afeaaa62bd7b69ce5"
  ai_journey_mode                     = "widget_booking"
  ai_journey_widget_session_id        = "01a11c48-dbc2-76de-a873-f41664da5ccb"
  api_public_origin                   = "https://lead-agent-staging-api-synthetic.ww.run.app"
  web_public_origin                   = "https://lead-agent-staging-web-synthetic.ww.run.app"
  auth0_issuer                        = "https://synthetic.invalid/"
  auth0_client_id                     = "synthetic-public-client"
  telegram_bot_username               = "synthetic_staging_bot"
  instagram_app_id                    = "1234567890"
}

run "default_off" {
  command = apply
  assert {
    condition     = length([for entry in google_cloud_run_v2_service.api[0].template[0].containers[0].env : entry if contains(["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"], entry.name)]) == 0
    error_message = "Default-off must add no exercise environment entries."
  }
}

run "default_off_plan" { command = plan }

run "enable_plan" {
  command = plan
  variables {
    s22_connection_fault_enabled = true
    s22_connection_fault_profile = jsonencode({ version = 1, exerciseId = "12121212-1212-4121-8121-121212121212", projectId = "lead-agent-stg-739284", region = "me-central1", service = "lead-agent-staging-api", sourceSha = "7a4201c824be3db2396b51c14d62e6758f43e860", sessionDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", baselineAt = "2030-01-01T00:01:00.000Z", faultAt = "2030-01-01T00:02:30.000Z", expiresAt = "2030-01-01T00:08:30.000Z" })
  }
  assert {
    condition     = length([for entry in google_cloud_run_v2_service.api[0].template[0].containers[0].env : entry if contains(["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"], entry.name)]) == 3
    error_message = "Enable must add exactly the three reviewed environment names."
  }
  assert {
    condition     = issensitive(one([for entry in google_cloud_run_v2_service.api[0].template[0].containers[0].env : entry.value if entry.name == "S22_CONNECTION_FAULT_PROFILE"]))
    error_message = "The raw profile must remain sensitive."
  }
}

run "enable_apply" {
  command = apply
  variables {
    s22_connection_fault_enabled = true
    s22_connection_fault_profile = jsonencode({ version = 1, exerciseId = "12121212-1212-4121-8121-121212121212", projectId = "lead-agent-stg-739284", region = "me-central1", service = "lead-agent-staging-api", sourceSha = "7a4201c824be3db2396b51c14d62e6758f43e860", sessionDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", baselineAt = "2030-01-01T00:01:00.000Z", faultAt = "2030-01-01T00:02:30.000Z", expiresAt = "2030-01-01T00:08:30.000Z" })
  }
}

run "remove_plan" {
  command = plan
  assert {
    condition     = length([for entry in google_cloud_run_v2_service.api[0].template[0].containers[0].env : entry if contains(["S22_CONNECTION_FAULT_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"], entry.name)]) == 0
    error_message = "Removal must remove all three exercise entries."
  }
}
run "remove_apply" { command = apply }
run "removed_converges" { command = plan }

run "denies_profile_while_off" {
  command = plan
  variables { s22_connection_fault_profile = "{}" }
  expect_failures = [var.s22_connection_fault_profile]
}
run "denies_enable_without_profile" {
  command = plan
  variables { s22_connection_fault_enabled = true }
  expect_failures = [var.s22_connection_fault_profile]
}
