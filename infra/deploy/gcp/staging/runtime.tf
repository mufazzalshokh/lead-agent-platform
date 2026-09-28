locals {
  bootstrap_command = ["node"]
  bootstrap_args = [
    "-e",
    "require('http').createServer((_,response)=>{response.writeHead(200,{'content-type':'text/plain'});response.end('ok')}).listen(process.env.PORT||8080,'0.0.0.0')",
  ]

  provenance_env = {
    DEPLOYMENT_ENVIRONMENT    = var.environment
    DEPLOYMENT_GIT_SHA        = var.git_commit_sha
    DEPLOYMENT_MIGRATION_HEAD = var.migration_head
    DEPLOYMENT_TIMESTAMP      = var.deployment_timestamp
  }

  migrator_git_commit_sha = var.migrator_git_commit_sha != "" ? var.migrator_git_commit_sha : var.git_commit_sha
  migrator_deployment_timestamp = (
    var.migrator_deployment_timestamp != "" ? var.migrator_deployment_timestamp : var.deployment_timestamp
  )
  migrator_provenance_env = merge(local.provenance_env, {
    DEPLOYMENT_GIT_SHA   = local.migrator_git_commit_sha
    DEPLOYMENT_TIMESTAMP = local.migrator_deployment_timestamp
  })

  api_plain_env = merge(local.provenance_env, {
    APP_ENV                         = "production"
    AUTH0_CALLBACK_URI              = "${var.api_public_origin}/v1/staff/auth/callback"
    AUTH0_CLIENT_ID                 = var.auth0_client_id
    AUTH0_ISSUER                    = var.auth0_issuer
    AUTH_PRODUCTION_MFA_REQUIRED    = "true"
    CREDENTIAL_SECRET_RESOURCE      = google_secret_manager_secret.channel_credentials.id
    CUSTOMER_DATA_ENCRYPTION_KEY_ID = "s22-staging-v1"
    INSTAGRAM_APP_ID                = var.instagram_app_id
    INSTAGRAM_GRAPH_API_VERSION     = var.instagram_graph_api_version
    INSTAGRAM_OAUTH_REDIRECT_URI    = "${var.api_public_origin}/v1/integrations/instagram/callback"
    STAFF_ALLOWED_ORIGINS           = var.web_public_origin
    STAFF_APPLICATION_ORIGIN        = var.web_public_origin
    TELEGRAM_BOT_USERNAME           = var.telegram_bot_username
    TELEGRAM_WEBHOOK_URL            = "${var.api_public_origin}/v1/webhooks/telegram"
    WIDGET_PLATFORM_ORIGIN          = var.web_public_origin
    WIDGET_PUBLIC_API_ORIGIN        = var.api_public_origin
  })

  api_secret_env = {
    AUTH0_CLIENT_SECRET              = "auth0-client-secret"
    AUTH_BROWSER_ENVELOPE_KEY        = "auth-browser-envelope-key"
    AUTH_DATABASE_URL                = "auth-database-url"
    CUSTOMER_DATA_ENCRYPTION_KEY     = "customer-data-encryption-key"
    CUSTOMER_DATA_LOOKUP_KEY         = "customer-data-lookup-key"
    DATABASE_URL                     = "runtime-database-url"
    INGRESS_DATABASE_URL             = "ingress-database-url"
    INSTAGRAM_APP_SECRET             = "instagram-app-secret"
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN   = "instagram-webhook-verify-token"
    INVITATION_TARGET_ENCRYPTION_KEY = "invitation-target-encryption-key"
    INVITATION_TARGET_LOOKUP_KEY     = "invitation-target-lookup-key"
    TELEGRAM_BOT_TOKEN               = "telegram-bot-token"
    TELEGRAM_WEBHOOK_SECRET          = "telegram-webhook-secret"
    WIDGET_EXCHANGE_ENCRYPTION_KEY   = "widget-exchange-encryption-key"
    WIDGET_SIGNING_KEY               = "widget-signing-key"
  }

  worker_plain_env = merge(local.provenance_env, {
    AI_MODEL                        = "gemini-3.8-flash"
    AI_PROVIDER                     = "gemini"
    AI_REQUEST_TIMEOUT_MS           = "15000"
    CREDENTIAL_SECRET_RESOURCE      = google_secret_manager_secret.channel_credentials.id
    CUSTOMER_DATA_ENCRYPTION_KEY_ID = "s22-staging-v1"
    INSTAGRAM_APP_ID                = var.instagram_app_id
    INSTAGRAM_GRAPH_API_VERSION     = var.instagram_graph_api_version
    INSTAGRAM_OAUTH_REDIRECT_URI    = "${var.api_public_origin}/v1/integrations/instagram/callback"
    TELEGRAM_BOT_USERNAME           = var.telegram_bot_username
    TELEGRAM_WEBHOOK_URL            = "${var.api_public_origin}/v1/webhooks/telegram"
  })

  worker_secret_env = {
    CUSTOMER_DATA_ENCRYPTION_KEY   = "customer-data-encryption-key"
    CUSTOMER_DATA_LOOKUP_KEY       = "customer-data-lookup-key"
    DATABASE_URL                   = "runtime-database-url"
    GEMINI_API_KEY                 = "gemini-api-key"
    INSTAGRAM_APP_SECRET           = "instagram-app-secret"
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "instagram-webhook-verify-token"
    QUEUE_DATABASE_URL             = "queue-database-url"
    TELEGRAM_BOT_TOKEN             = "telegram-bot-token"
    TELEGRAM_WEBHOOK_SECRET        = "telegram-webhook-secret"
  }

  migrator_secret_env = {
    AUTH_DATABASE_URL      = "auth-database-url"
    DATABASE_URL           = "runtime-database-url"
    INGRESS_DATABASE_URL   = "ingress-database-url"
    MIGRATION_DATABASE_URL = "migration-database-url"
    QUEUE_DATABASE_URL     = "queue-database-url"
  }

  deployment_labels = merge(local.common_labels, {
    git-sha        = var.deploy_runtime ? substr(var.git_commit_sha, 0, 12) : "foundation"
    migration-head = replace(var.migration_head, "_", "-")
  })
  migrator_deployment_labels = merge(local.deployment_labels, {
    git-sha = substr(local.migrator_git_commit_sha, 0, 12)
  })
}

resource "google_cloud_run_v2_service" "api" {
  count = var.deploy_runtime ? 1 : 0

  name                = "${local.name_prefix}-api"
  project             = var.project_id
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.deployment_labels

  template {
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = 0
      max_instance_count = var.api_max_instance_count
    }

    containers {
      image   = var.api_image
      command = var.bootstrap_runtime ? local.bootstrap_command : null
      args    = var.bootstrap_runtime ? local.bootstrap_args : null

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.bootstrap_runtime ? {} : local.api_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.bootstrap_runtime ? {} : local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = var.bootstrap_runtime ? "/" : "/health"
        }
      }

      liveness_probe {
        timeout_seconds   = 3
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = var.bootstrap_runtime ? "/" : "/health"
        }
      }
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.staging.id
        subnetwork = google_compute_subnetwork.cloud_run.id
        tags       = ["lead-agent-api"]
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.bootstrap_runtime || (var.auth0_issuer != "" && var.auth0_client_id != "" && var.telegram_bot_username != "" && var.instagram_app_id != "")
      error_message = "Full runtime deployment requires the staging Auth0, Telegram and Instagram public identifiers."
    }
  }

  depends_on = [google_service_account_iam_member.deployer_act_as]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = var.deploy_runtime ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.api[0].location
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "web" {
  count = var.deploy_runtime ? 1 : 0

  name                = "${local.name_prefix}-web"
  project             = var.project_id
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.deployment_labels

  template {
    service_account                  = google_service_account.web.email
    timeout                          = "60s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = var.web_max_instance_count
    }

    containers {
      image   = var.web_image
      command = var.bootstrap_runtime ? local.bootstrap_command : null
      args    = var.bootstrap_runtime ? local.bootstrap_args : null

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.bootstrap_runtime ? {} : merge(local.provenance_env, {
          NEXT_PUBLIC_API_ORIGIN   = var.api_public_origin
          WIDGET_PUBLIC_API_ORIGIN = var.api_public_origin
        })
        content {
          name  = env.key
          value = env.value
        }
      }

      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = var.bootstrap_runtime ? "/" : "/staff"
        }
      }
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.staging.id
        subnetwork = google_compute_subnetwork.cloud_run.id
        tags       = ["lead-agent-web"]
      }
    }
  }

  depends_on = [google_service_account_iam_member.deployer_act_as]
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  count = var.deploy_runtime ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.web[0].location
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_worker_pool" "worker" {
  count = var.deploy_runtime && !var.bootstrap_runtime ? 1 : 0

  name     = "${local.name_prefix}-worker"
  project  = var.project_id
  location = var.region
  labels   = local.deployment_labels

  scaling {
    scaling_mode          = "MANUAL"
    manual_instance_count = var.worker_instance_count
  }

  template {
    service_account = google_service_account.worker.email

    containers {
      image = var.worker_image

      resources {
        limits = {
          cpu    = "1"
          memory = var.worker_memory
        }
      }

      dynamic "env" {
        for_each = local.worker_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.worker_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.staging.id
        subnetwork = google_compute_subnetwork.cloud_run.id
        tags       = ["lead-agent-worker"]
      }
    }
  }

  depends_on = [google_service_account_iam_member.deployer_act_as]
}

resource "google_cloud_run_v2_job" "migrator" {
  count = var.prepare_migration ? 1 : 0

  name                = "${local.name_prefix}-migrator"
  project             = var.project_id
  location            = var.region
  deletion_protection = true
  labels              = local.migrator_deployment_labels

  lifecycle {
    precondition {
      condition     = var.cloud_sql_activation_policy == "ALWAYS"
      error_message = "The one-shot migrator requires an active Cloud SQL instance."
    }
  }

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.migrator.email
      max_retries     = 0
      timeout         = "900s"

      containers {
        image   = var.migrator_image
        command = ["node"]
        args    = ["dist/index.js"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = merge(local.migrator_provenance_env, {
            DEPLOYMENT_IMAGE_DIGEST = var.migrator_image
          })
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.migrator_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.runtime[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.staging.id
          subnetwork = google_compute_subnetwork.cloud_run.id
          tags       = ["lead-agent-migrator"]
        }
      }
    }
  }

  depends_on = [google_service_account_iam_member.deployer_act_as]
}
