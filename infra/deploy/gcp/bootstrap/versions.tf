terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  backend "gcs" {
    prefix = "lead-agent-platform/bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
