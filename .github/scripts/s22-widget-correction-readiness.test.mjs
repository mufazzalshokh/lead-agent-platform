import assert from "node:assert/strict";
import test from "node:test";

import {
  correctionRuntime,
  prepareCorrectionReadiness,
  runCorrectionReadiness,
} from "./s22-widget-correction-readiness.mjs";

const session = "01a11c00-abcd-7123-8b01-0123456789ab";

test("correction wrapper pins verified source, immutable refs and the one prepared timestamp", () => {
  assert.equal(correctionRuntime.source, "1ecd729d856fdeff22a55cc54e1259c7adcf6472");
  assert.equal(correctionRuntime.timestamp, "2026-10-08T15:08:01Z");
  assert.match(
    correctionRuntime.worker,
    /\/worker@sha256:9bb77154a6057981b3fed82164defa222ff6b893a5fbe5563a4e06f9140ab381$/u,
  );
  assert.match(
    correctionRuntime.image,
    /\/migrator@sha256:f4c6e5bdbf0e39a0fe6042e090b93ebaa21209a628bdc5cb889a49f8a03beace$/u,
  );
  assert.equal(Object.isFrozen(correctionRuntime), true);
});

test("only explicit selected-session input is accepted; prepared expectations are immutable", () => {
  const inputs = prepareCorrectionReadiness(["--session", session]);
  assert.equal(inputs.sessionId, session);
  assert.equal(inputs.deploymentTimestamp, correctionRuntime.timestamp);
  assert.equal(inputs.reviewedRuntime, correctionRuntime);
  assert.equal(Object.isFrozen(inputs), true);
});

for (const args of [
  [],
  ["--session"],
  ["--session", undefined],
  ["--session", "invalid"],
  ["--session", "01a11c00-abcd-4123-8b01-0123456789ab"],
  ["--session", "01a11b26-c51d-78ba-8e81-62e6e7331ab8"],
  ["--session", "01a11b7d-ddbf-759e-b4e3-1602d9e2238c"],
  ["--source", correctionRuntime.source],
  ["--session", session, "--source", correctionRuntime.source],
  ["--session", session, "--deployment-timestamp", correctionRuntime.timestamp],
])
  test("malformed, expired or additional selectors fail before credentials/execution", async () => {
    let calls = 0;
    await assert.rejects(
      runCorrectionReadiness(args, {}, async () => {
        calls++;
      }),
    );
    assert.equal(calls, 0);
  });

test("observers cannot override the verified source/time/session packet", async () => {
  let calls = 0;
  const result = await runCorrectionReadiness(
    ["--session", session],
    { sessionId: "foreign", deploymentTimestamp: "foreign", reviewedRuntime: {} },
    async (inputs) => {
      calls++;
      assert.equal(inputs.sessionId, session);
      assert.equal(inputs.deploymentTimestamp, correctionRuntime.timestamp);
      assert.equal(inputs.reviewedRuntime, correctionRuntime);
      return { controlled: true };
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { controlled: true });
});
