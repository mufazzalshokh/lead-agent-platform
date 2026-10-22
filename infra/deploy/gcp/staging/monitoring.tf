resource "google_monitoring_alert_policy" "api_errors" {
  display_name          = "Lead Agent staging API server errors"
  project               = var.project_id
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = "API 5xx rate exceeds 1%"
    condition_threshold {
      filter             = "resource.type = \"cloud_run_revision\" AND resource.label.project_id = \"${var.project_id}\" AND resource.label.location = \"${var.region}\" AND resource.label.service_name = \"${local.name_prefix}-api\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      denominator_filter = "resource.type = \"cloud_run_revision\" AND resource.label.project_id = \"${var.project_id}\" AND resource.label.location = \"${var.region}\" AND resource.label.service_name = \"${local.name_prefix}-api\" AND metric.type = \"run.googleapis.com/request_count\""
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.01
      duration           = "300s"

      # Matching labels and sums make this a service-wide ratio, not an average
      # of per-revision percentages or an absolute count of errors per second.
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name", "resource.label.location"]
      }

      denominator_aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name", "resource.label.location"]
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "database_cpu" {
  display_name          = "Lead Agent staging Cloud SQL CPU saturation"
  project               = var.project_id
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = "Cloud SQL CPU above 80%"
    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.label.database_id = \"${var.project_id}:${google_sql_database_instance.staging.name}\" AND metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_billing_budget" "staging" {
  billing_account = var.billing_account_id
  display_name    = "Lead Agent S22 staging USD 25 target"

  budget_filter {
    projects = ["projects/${data.google_project.staging.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "25"
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

}

resource "google_billing_budget" "staging_hard_ceiling" {
  billing_account = var.billing_account_id
  display_name    = "Lead Agent S22 staging USD 50 hard ceiling"

  budget_filter {
    projects = ["projects/${data.google_project.staging.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "50"
    }
  }

  threshold_rules {
    threshold_percent = 0.8
  }
  threshold_rules {
    threshold_percent = 1.0
  }
}

data "google_project" "staging" {
  project_id = var.project_id
}
