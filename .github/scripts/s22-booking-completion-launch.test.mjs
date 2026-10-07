import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = fileURLToPath(new URL(".", import.meta.url)).replaceAll("\\", "/");
const launcher = `${directory}s22-booking-completion-launch-v1.sh`;
const source = readFileSync(launcher, "utf8");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const commit = "a".repeat(40);

test("download manifest pins exactly the three reviewed module bytes with Git LF endings", () => {
  const manifest = source.match(/MANIFEST'\n([\s\S]+?)\nMANIFEST\n/u)?.[1];
  assert.ok(manifest);
  const entries = manifest.split("\n");
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    const [hash, name] = entry.split(" ");
    assert.match(hash, /^[a-f0-9]{64}$/u);
    assert.match(name, /^s22-booking-(?:evidence(?:-readonly)?|completion-readonly)\.mjs$/u);
    const bytes = readFileSync(`${directory}${name}`);
    assert.equal(bytes.includes(Buffer.from([13, 10])), false);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  }
});

test("real Bash syntax is valid and malformed arguments fail before any authentication or remote call", () => {
  const syntax = spawnSync(bash, ["-n", launcher], { encoding: "utf8", timeout: 10000 });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const args of [[], ["main"], [commit, "extra"]]) {
    const result = spawnSync(bash, [launcher, ...args], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /BLOCKED: supply exactly one reviewed/u);
    assert.equal(result.stdout, "");
  }
});

// This subprocess proves shell wiring/checksums with local download fixtures;
// the actual Node/container bootstrap is covered separately with real modules.
const controlled = String.raw`
  set -euo pipefail
  task_sources=$2
  [[ $(uname -s) != *MINGW* ]] || task_sources=$(cygpath -u "$task_sources")
  task_directory=$(mktemp -d /tmp/s22-completion-launch-test.XXXXXX)
  trap 'find "$task_directory" -type f -delete; find "$task_directory" -depth -type d -empty -delete' EXIT
  mktemp() { [[ $* == '-d /tmp/s22-booking-completion.XXXXXX' ]]; printf '%s\n' "$task_directory"; }
  gcloud() { printf 'UNEXPECTED_GCLOUD_CALL\n' >&2; return 99; }
  curl() {
    local url='' output='' argument
    while [[ $# -gt 0 ]]; do
      argument=$1; shift
      if [[ $argument == -o ]]; then output=$1; shift;
      elif [[ $argument == https://* ]]; then url=$argument; fi
    done
    [[ $url == https://raw.githubusercontent.com/mufazzalshokh/lead-agent-platform/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.github/scripts/s22-booking-*.mjs ]]
    cp "$task_sources/$(basename "$url")" "$output"
    if [[ $CONTROLLED_TAMPER == 1 ]]; then printf '\nchanged\n' >> "$output"; fi
  }
  node() {
    if [[ $* == --version ]]; then printf 'v24.14.0\n'; return; fi
    [[ $* == 's22-booking-evidence.mjs --complete-booking' ]]
    [[ $PWD == "$task_directory" ]]
    [[ -f s22-booking-evidence-readonly.mjs && -f s22-booking-completion-readonly.mjs ]]
    printf 'CONTROLLED_NODE_INVOCATION_ONCE\n'
  }
  export -f curl gcloud node mktemp
  export task_sources task_directory
  bash "$1" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

test("actual download helper verifies real fixture hashes and invokes completion exactly once, without network", () => {
  const result = spawnSync(bash, ["-c", controlled, "fixture", launcher, directory], {
    env: { ...process.env, CONTROLLED_TAMPER: "0" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Download verification: PASS/u);
  assert.equal(result.stdout.match(/CONTROLLED_NODE_INVOCATION_ONCE/gu)?.length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_GCLOUD_CALL/u);
});

test("tampered downloaded bytes fail before diagnostic invocation or authentication", () => {
  const result = spawnSync(bash, ["-c", controlled, "fixture", launcher, directory], {
    env: { ...process.env, CONTROLLED_TAMPER: "1" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /BLOCKED: reviewed tooling checksum mismatch/u);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /CONTROLLED_NODE_INVOCATION|UNEXPECTED_GCLOUD_CALL/u,
  );
});
