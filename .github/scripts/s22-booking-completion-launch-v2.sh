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
f04605e315533369ed5fcc2b277426d004ed273a9cc6d8315205feb9b0290cff s22-booking-evidence.mjs
3f6685458c71d3c8fcb640ab3fff8614520d7df920f96474d56d1288cbfdceb7 s22-booking-evidence-readonly.mjs
91d4bb6d783f900704c145d2e4bfa897007a8df26502b27fb85365af1caedc12 s22-booking-completion-readonly.mjs
MANIFEST

printf 'Download verification: PASS\n'
printf 'One read-only dispatch/accounting check; passed booking checks are not repeated.\n'
cd "$task_directory"
set +e
node s22-booking-evidence.mjs --complete-booking-accounting
task_result=$?
set -e
printf 'Sanitized evidence directory: %s\n' "$task_directory"
exit "$task_result"
