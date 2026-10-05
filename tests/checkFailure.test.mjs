import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockBackend } from "../src/dev/mockBackend.ts";
import { findScenario } from "../src/dev/scenarios.ts";
import { describeCheckFailure } from "../src/lib/checkFailure.ts";

async function reportFor(id) {
  const backend = createMockBackend(findScenario(id), async () => undefined);
  return backend.invoke("check_device", { onEvent: backend.createChannel() });
}

test("unsupported models show a readable explanation and only offer another iPod", async () => {
  const report = await reportFor("unsupported-model");
  const failure = describeCheckFailure(report, "MB029; HwVr 0x00130000 (unsupported target)");
  assert.equal(failure.title, "This iPod model isn’t supported.");
  assert.equal(failure.message, "RepriseOS doesn’t currently support your iPod (MB029).");
  assert.equal(failure.action, "another-ipod");
  assert.doesNotMatch(failure.message, /HwVr|0x/);
  assert.match(report.checks.find((check) => check.id === "model").detail, /HwVr/);
});

test("firmware requirements and package mismatches have different recovery actions", async () => {
  const firmware = describeCheckFailure(await reportFor("firmware-required"), "Diagnostic");
  assert.equal(
    firmware.message,
    "Your iPod is on Apple firmware 2.0.2; upgrade to 2.0.4 to install RepriseOS.",
  );
  assert.equal(firmware.action, "start");
  const mismatch = describeCheckFailure(await reportFor("package-mismatch"), "Diagnostic");
  assert.equal(mismatch.action, "firmware");
  assert.match(mismatch.message, /MC293/);
});

test("cleanup failures and incomplete checks retain their actual errors", async () => {
  const report = await reportFor("unsupported-model");
  report.cleanup = { state: "failed", detail: "Disconnected" };
  const failure = describeCheckFailure(report, "DFU cleanup failed: Disconnected");
  assert.equal(failure.action, "retry");
  assert.equal(failure.message, "DFU cleanup failed: Disconnected");
  assert.equal(describeCheckFailure(null, "Read failed").action, "retry");
  assert.equal(describeCheckFailure(report, null), null);
});
