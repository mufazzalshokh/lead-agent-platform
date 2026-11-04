#!/usr/bin/env bash
set -euo pipefail
[[ "$PROJECT_ID" == "lead-agent-stg-739284" ]]
[[ "$REQUESTED_SHA" =~ ^[0-9a-f]{40}$ ]]
INVENTORY_DIR="$(mktemp -d "$RUNNER_TEMP/s22-inventory.XXXXXX")"
trap 'rm -f "$INVENTORY_DIR/sql.json" "$INVENTORY_DIR/backups.json" "$INVENTORY_DIR/alerts.json" "$INVENTORY_DIR/worker.json"; rmdir "$INVENTORY_DIR"' EXIT

timeout 90s gcloud sql instances describe lead-agent-staging-postgres17 \
  --project="$PROJECT_ID" --format=json > "$INVENTORY_DIR/sql.json"
timeout 90s gcloud sql backups list --instance=lead-agent-staging-postgres17 \
  --project="$PROJECT_ID" --limit=10 --format=json > "$INVENTORY_DIR/backups.json"
timeout 90s gcloud run worker-pools describe lead-agent-staging-worker \
  --project="$PROJECT_ID" --region=me-central1 --format=json > "$INVENTORY_DIR/worker.json"
ACCESS_TOKEN="$(gcloud auth print-access-token)"
curl --fail --silent --show-error --max-time 30 \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://monitoring.googleapis.com/v3/projects/$PROJECT_ID/alertPolicies?pageSize=100" \
  > "$INVENTORY_DIR/alerts.json"
unset ACCESS_TOKEN
export S22_API_HEALTH_STATUS S22_WEB_HEALTH_STATUS
S22_API_HEALTH_STATUS="$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' https://lead-agent-staging-api-uj7pjzpksq-ww.a.run.app/health)"
S22_WEB_HEALTH_STATUS="$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' 'https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/staff?organization=01a0ee39-91a9-7293-82c0-5b7046c10115')"
node .github/scripts/s22-acceptance-inventory.mjs "$INVENTORY_DIR" \
  | tee s22-acceptance-inventory.json
