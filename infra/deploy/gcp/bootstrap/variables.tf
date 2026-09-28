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

variable "state_bucket_name" {
  description = "Globally unique GCS bucket name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must satisfy GCS naming rules."
  }
}

variable "billing_account_id" {
  description = "Billing account that owns the staging project and budget."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the canonical XXXXXX-XXXXXX-XXXXXX form."
  }
}

variable "github_repository" {
  description = "The only GitHub repository trusted by staging WIF."
  type        = string
  default     = "mufazzalshokh/lead-agent-platform"

  validation {
    condition     = var.github_repository == "mufazzalshokh/lead-agent-platform"
    error_message = "The approved S22 WIF repository is fixed."
  }
}

variable "temporary_logging_viewer_enabled" {
  description = "Temporarily allow the staging deployer to read sanitized S22 Cloud Run diagnostic logs."
  type        = bool
  default     = false
}
