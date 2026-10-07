#!/usr/bin/env bash
# Download reviewed, checksum-pinned diagnostic tooling. No uploads or installs.
set -euo pipefail

if [[ $# != 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  printf 'BLOCKED: supply exactly one reviewed 40-character tooling commit\n' >&2
  exit 1
fi
task_commit=$1
for task_command in curl sha256sum node gcloud mktemp; do
  if ! command -v "$task_command" >/dev/null 2>&1; then
    printf 'BLOCKED: required existing command unavailable: %s\n' "$task_command" >&2
    exit 1
  fi
done
task_node_version=$(node --version)
if [[ ! $task_node_version =~ ^v([0-9]+)\. || ${BASH_REMATCH[1]} -lt 20 ]]; then
  printf 'BLOCKED: existing Node.js 20 or newer required\n' >&2
  exit 1
fi

task_directory=$(mktemp -d /tmp/s22-booking-completion.XXXXXX)
task_base="https://raw.githubusercontent.com/mufazzalshokh/lead-agent-platform/$task_commit/.github/scripts"
while read -r task_hash task_file; do
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
    --connect-timeout 5 --max-time 15 --retry 0 \
    "$task_base/$task_file" -o "$task_directory/$task_file"
  if ! printf '%s  %s\n' "$task_hash" "$task_directory/$task_file" | sha256sum --check --status; then
    printf 'BLOCKED: reviewed tooling checksum mismatch: %s\n' "$task_file" >&2
    exit 1
  fi
done <<'MANIFEST'
da6dda5ac9b1033fef1e8a1ec42adc83d81f8c9b45ab9b121a8e597200f911ab s22-booking-evidence.mjs
feefd98cfa9b578b2e811e17aa42532e128589fada397c01477ff126eb7a8b5d s22-booking-evidence-readonly.mjs
cf6552bd9d5383d3a4cf4cf570c866f227ce9b638c432dba89d007a96826871b s22-booking-completion-readonly.mjs
MANIFEST

printf 'Download verification: PASS\n'
printf 'One read-only booking check; no message, provider call or migration.\n'
cd "$task_directory"
set +e
node s22-booking-evidence.mjs --complete-booking
task_result=$?
set -e
printf 'Sanitized evidence directory: %s\n' "$task_directory"
exit "$task_result"
