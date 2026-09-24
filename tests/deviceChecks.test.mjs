import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  checkIds,
  discoverDevices,
  getCheckState,
  retryDeviceChecks,
  startDeviceChecks,
} from "../src/lib/deviceChecks.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;
const selector = { bus: 1, address: 2 };
const device = {
  selector,
  port_path: [1, 2],
  vendor_id: 0x05ac,
  product_id: 0x1223,
  mode: "DFU",
  dfu_candidate: true,
};
const report = (cleanup = { state: "idle" }) => ({
  checks: checkIds.map((id) => ({ id, status: "passed", detail: "Passed" })),
  compatible: true,
  cleanup,
  identity: { model: "MC293", serial: "fixture", recorded_firmware: "2.0.4" },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("waits for discovery, prevents duplicate starts, and ignores stale events", async () => {
  const detection = deferred();
  const check = deferred();
  let discoveries = 0;
  let checks = 0;
  let channel;
  mockIPC((command, args) => {
    if (command === "discover_devices") {
      discoveries++;
      return detection.promise;
    }
    assert.equal(command, "check_device");
    assert.deepEqual(args.selector, selector);
    checks++;
    channel = args.onEvent;
    return check.promise;
  });
  const first = discoverDevices();
  const second = discoverDevices();
  assert.equal(first, second);
  startDeviceChecks(device);
  startDeviceChecks(device);
  assert.equal(discoveries, 1);
  assert.equal(checks, 0);
  detection.resolve([]);
  await setImmediate();
  assert.equal(checks, 1);
  channel.onmessage({ event: "check", id: "rom", status: "running", detail: "Reading" });
  assert.equal(getCheckState().checks.find((entry) => entry.id === "rom").status, "running");
  assert.equal(getCheckState().running, true);
  assert.equal(getCheckState().report, null);
  check.resolve(report());
  await setImmediate();
  assert.equal(getCheckState().running, false);
  assert.equal(getCheckState().error, null);
  const completed = getCheckState();
  channel.onmessage({ event: "check", id: "rom", status: "failed", detail: "Late" });
  assert.equal(getCheckState(), completed);

  const retry = deferred();
  mockIPC(() => retry.promise);
  startDeviceChecks(device);
  const retryState = getCheckState();
  channel.onmessage({ event: "check", id: "rom", status: "failed", detail: "Previous job" });
  assert.equal(getCheckState(), retryState);
  retry.resolve(report());
  await setImmediate();
});

test("cleanup failure blocks success even when all checks passed", async () => {
  mockIPC(() => report({ state: "failed", detail: "USB disconnected" }));
  startDeviceChecks(device);
  await setImmediate();
  assert.equal(getCheckState().running, false);
  assert.match(getCheckState().error, /cleanup failed.*USB disconnected/);
});

test("USB claim failure marks access failed and ends the job", async () => {
  mockIPC(() => Promise.reject({ stage: "access", detail: "Close other USB tools" }));
  startDeviceChecks(device);
  await setImmediate();
  assert.equal(getCheckState().running, false);
  assert.equal(getCheckState().report, null);
  assert.equal(getCheckState().error, "Close other USB tools");
  assert.equal(getCheckState().checks.find((check) => check.id === "access").status, "failed");
  assert.ok(
    getCheckState()
      .checks.filter((check) => check.id !== "access")
      .every((check) => check.status === "skipped"),
  );
});

test("unsupported devices stay blocked and preserve check details", async () => {
  const unsupported = report();
  unsupported.compatible = false;
  unsupported.checks[4] = { id: "model", status: "failed", detail: "Unsupported model" };
  mockIPC(() => unsupported);
  startDeviceChecks(device);
  await setImmediate();
  assert.equal(getCheckState().error, "Unsupported model");
  assert.equal(getCheckState().report.compatible, false);
});

async function failedCheck() {
  mockIPC(() => Promise.reject({ stage: "usb", detail: "Disconnected" }));
  startDeviceChecks(device);
  await setImmediate();
}

test("channel setup failure ends the job so retry stays available", async () => {
  mockIPC(() => report());
  window.__TAURI_INTERNALS__.transformCallback = () => {
    throw new Error("Channel unavailable");
  };
  startDeviceChecks(device);
  await setImmediate();
  assert.equal(getCheckState().running, false);
  assert.match(getCheckState().error, /Channel unavailable/);
});

test("retry rediscovers an unchanged device and starts exactly one check", async () => {
  await failedCheck();
  let checks = 0;
  mockIPC((command) => {
    if (command === "discover_devices") return [device];
    checks++;
    return report();
  });
  await Promise.all([retryDeviceChecks(), retryDeviceChecks()]);
  await setImmediate();
  assert.equal(checks, 1);
  assert.equal(getCheckState().error, null);
  assert.equal(getCheckState().replacement, null);
});

test("changed USB address or port requires explicit selection before checking", async () => {
  for (const replacement of [
    { ...device, selector: { bus: 1, address: 3 } },
    { ...device, port_path: [1, 3] },
  ]) {
    await failedCheck();
    let checks = 0;
    mockIPC((command, args) => {
      if (command === "discover_devices") return [replacement];
      checks++;
      assert.deepEqual(args.selector, replacement.selector);
      return report();
    });
    await retryDeviceChecks();
    assert.equal(checks, 0);
    assert.equal(getCheckState().running, false);
    assert.deepEqual(getCheckState().replacement, replacement);
    startDeviceChecks(getCheckState().replacement);
    await setImmediate();
    assert.equal(checks, 1);
    assert.equal(getCheckState().error, null);
  }
});

test("retry handles absent, non-DFU, multiple, and inaccessible devices", async () => {
  for (const [devices, message] of [
    [[], /Reconnect/],
    [[{ ...device, dfu_candidate: false }], /Reconnect/],
    [[device, { ...device, selector: { bus: 1, address: 3 } }], /More than one/],
  ]) {
    await failedCheck();
    mockIPC((command) => {
      assert.equal(command, "discover_devices");
      return devices;
    });
    await retryDeviceChecks();
    assert.equal(getCheckState().reconnecting, false);
    assert.equal(getCheckState().replacement, null);
    assert.match(getCheckState().error, message);
  }
  mockIPC(() => Promise.reject({ detail: "USB access failed" }));
  await retryDeviceChecks();
  assert.equal(getCheckState().reconnecting, false);
  assert.equal(getCheckState().error, "USB access failed");
});

test("session log retains failed attempts and cleanup through a successful retry", async () => {
  const { getSessionLog } = await import("../src/lib/sessionLog.ts");
  const before = getSessionLog().length;
  let attempts = 0;
  mockIPC((command) => {
    if (command === "discover_devices") return [device];
    if (++attempts === 1) throw { stage: "rom", detail: "fixture read failed" };
    return report();
  });
  startDeviceChecks(device);
  await setImmediate();
  const failedHistory = getSessionLog();
  assert.ok(failedHistory.slice(before).some((entry) => entry.includes("fixture read failed")));
  await retryDeviceChecks();
  await setImmediate();
  const history = getSessionLog();
  assert.deepEqual(history.slice(0, failedHistory.length), failedHistory);
  assert.ok(history.slice(before).some((entry) => entry.includes("Retry requested")));
  assert.ok(history.slice(before).some((entry) => entry.includes("DFU cleanup: idle")));
  assert.ok(history.at(-1).includes("Device compatibility checks passed"));
});
