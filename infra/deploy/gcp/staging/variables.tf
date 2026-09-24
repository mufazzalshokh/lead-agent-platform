variable "project_id" {
  description = "Billing-enabled, staging-only Google Cloud project ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a canonical Google Cloud project ID."
  }
}

variable "region" {
  description = "Approved S22 staging region."
  type        = string
  default     = "me-central1"

  validation {
    condition     = var.region == "me-central1"
    error_message = "S22 staging is frozen to me-central1."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "staging"

  validation {
    condition     = var.environment == "staging"
    error_message = "This stack is staging-only."
  }
}

variable "deploy_runtime" {
  description = "Create Cloud Run workloads after foundation resources and images are ready."
  type        = bool
  default     = false
}

variable "bootstrap_runtime" {
  description = "Create temporary health-only API/Web revisions so their run.app origins can be frozen before full runtime deployment."
  type        = bool
  default     = false

  validation {
    condition     = !var.bootstrap_runtime || var.deploy_runtime
    error_message = "bootstrap_runtime requires deploy_runtime."
  }
}

variable "prepare_migration" {
  description = "Create the one-shot migrator while API/Web remain on health-only bootstrap revisions."
  type        = bool
  default     = false

  validation {
    condition     = !var.prepare_migration || var.deploy_runtime
    error_message = "prepare_migration requires deploy_runtime."
  }
}

variable "cloud_sql_tier" {
  description = "Cost-bounded Cloud SQL tier. Shared-core is the dormant/functional default; dedicated-core is temporary for capacity drills."
  type        = string
  default     = "db-f1-micro"

  validation {
    condition     = contains(["db-f1-micro", "db-custom-1-3840"], var.cloud_sql_tier)
    error_message = "S22 permits only db-f1-micro or the temporary db-custom-1-3840 capacity profile."
  }
}

variable "cloud_sql_activation_policy" {
  description = "ALWAYS during approved test windows; NEVER while staging is dormant."
  type        = string
  default     = "NEVER"

  validation {
    condition     = contains(["ALWAYS", "NEVER"], var.cloud_sql_activation_policy)
    error_message = "cloud_sql_activation_policy must be ALWAYS or NEVER."
  }
}

variable "api_max_instance_count" {
  description = "Bounded API scale ceiling; normally one and temporarily three for capacity measurement."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 3], var.api_max_instance_count)
    error_message = "api_max_instance_count must be 1 normally or 3 for the approved load profile."
  }
}

variable "web_max_instance_count" {
  description = "Bounded Web scale ceiling; normally one and temporarily two for capacity measurement."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 2], var.web_max_instance_count)
    error_message = "web_max_instance_count must be 1 normally or 2 for the approved load profile."
  }
}

variable "worker_instance_count" {
  description = "Worker pool is off while dormant and exactly one during approved test windows."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.worker_instance_count)
    error_message = "worker_instance_count must be zero or one."
  }
}

variable "worker_memory" {
  description = "Worker memory is 512 MiB normally and may be raised to 1 GiB for capacity measurement."
  type        = string
  default     = "512Mi"

  validation {
    condition     = contains(["512Mi", "1Gi"], var.worker_memory)
    error_message = "worker_memory must be 512Mi or 1Gi."
  }
}

variable "git_commit_sha" {
  description = "Exact source commit for deployment provenance. Required for runtime plans."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || can(regex("^[0-9a-f]{40}$", var.git_commit_sha))
    error_message = "Runtime deployments require a full lowercase Git SHA."
  }
}

variable "deployment_timestamp" {
  description = "UTC RFC3339 timestamp supplied once by the deployment workflow."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.deployment_timestamp))
    error_message = "Runtime deployments require an immutable UTC RFC3339 timestamp."
  }
}

variable "migration_head" {
  description = "Migration head packaged in the exact deployment artifact."
  type        = string
  default     = "0029_s21_thread_automation_controls"

  validation {
    condition     = var.migration_head == "0029_s21_thread_automation_controls"
    error_message = "S22 does not authorize a migration after 0029."
  }
}

variable "api_image" {
  description = "Immutable API image reference by sha256 digest."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || can(regex("^me-central1-docker\\.pkg\\.dev/[^/]+/[^/]+/api@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be a me-central1 Artifact Registry digest reference."
  }
}

variable "web_image" {
  description = "Immutable Web image reference by sha256 digest."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || can(regex("^me-central1-docker\\.pkg\\.dev/[^/]+/[^/]+/web@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "web_image must be a me-central1 Artifact Registry digest reference."
  }
}

variable "worker_image" {
  description = "Immutable worker image reference by sha256 digest."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || var.bootstrap_runtime || can(regex("^me-central1-docker\\.pkg\\.dev/[^/]+/[^/]+/worker@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "worker_image must be a me-central1 Artifact Registry digest reference."
  }
}

variable "migrator_image" {
  description = "Immutable migrator image reference by sha256 digest."
  type        = string
  default     = ""

  validation {
    condition     = !var.prepare_migration || can(regex("^me-central1-docker\\.pkg\\.dev/[^/]+/[^/]+/migrator@sha256:[0-9a-f]{64}$", var.migrator_image))
    error_message = "migrator_image must be a me-central1 Artifact Registry digest reference."
  }
}

variable "api_public_origin" {
  description = "Exact HTTPS API run.app origin captured after the bootstrap revision."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || var.bootstrap_runtime || can(regex("^https://[a-z0-9-]+\\.run\\.app$", var.api_public_origin))
    error_message = "Full runtime deployment requires the exact API run.app origin."
  }
}

variable "web_public_origin" {
  description = "Exact HTTPS Web run.app origin captured after the bootstrap revision."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || var.bootstrap_runtime || can(regex("^https://[a-z0-9-]+\\.run\\.app$", var.web_public_origin))
    error_message = "Full runtime deployment requires the exact Web run.app origin."
  }
}

variable "auth0_issuer" {
  description = "Isolated staging Auth0 issuer ending in a slash."
  type        = string
  default     = ""
}

variable "auth0_client_id" {
  description = "Isolated staging Auth0 client ID (not a secret)."
  type        = string
  default     = ""
}

variable "telegram_bot_username" {
  description = "Synthetic staging Telegram bot username (not its token)."
  type        = string
  default     = ""
}

variable "instagram_app_id" {
  description = "Synthetic staging Meta application ID (not its secret)."
  type        = string
  default     = ""
}

variable "instagram_graph_api_version" {
  description = "Approved Meta Graph API version for the staging app."
  type        = string
  default     = "v24.0"
}

variable "monitoring_notification_channel_ids" {
  description = "Existing Cloud Monitoring notification-channel resource IDs."
  type        = list(string)

  validation {
    condition     = length(var.monitoring_notification_channel_ids) > 0 && alltrue([for id in var.monitoring_notification_channel_ids : can(regex("^projects/[^/]+/notificationChannels/[0-9]+$", id))])
    error_message = "At least one canonical staging Monitoring notification channel is required."
  }
}

variable "billing_account_id" {
  description = "Billing account ID used to create target and hard-ceiling staging budgets."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the canonical XXXXXX-XXXXXX-XXXXXX form."
  }
}
