import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  cancelInstallation,
  getInstallationState,
  installationLabel,
  startInstallation,
} from "../src/lib/installation.ts";
import { getSessionLog } from "../src/lib/sessionLog.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;
const firmware = { filename: "firmware.ipsw", version: "2.0.5", sha256: "firmware-hash" };

test("starts once, forwards selected hashes, and waits for backend completion", async () => {
  let finish;
  let channel;
  let calls = 0;
  mockIPC((command, args) => {
    assert.equal(command, "install");
    assert.equal(args.firmwareSha256, "firmware-hash");
    assert.equal(args.packageDigest, "package-hash");
    calls++;
    channel = args.onEvent;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  startInstallation(firmware, "package-hash");
  startInstallation(firmware, "package-hash");
  assert.equal(calls, 1);
  for (const [stage, detail] of [
    ["backup", "Reading boot firmware"],
    ["backup", "Verifying boot firmware backup"],
    ["decrypt", "Preparing Apple firmware"],
    ["decrypt", "Decrypting Apple firmware"],
    ["uploadOsos", "Uploading RepriseOS"],
    ["uploadOsos", "Verifying RepriseOS"],
    ["uploadOsos", "Reconnecting to iPod"],
    ["bootloader", "Sending bootloader installer"],
  ]) {
    channel.onmessage({ stage, detail, completed: 100, total: 100, cancellable: true });
    assert.equal(installationLabel(getInstallationState().event), detail);
  }
  const progress = getInstallationState();
  channel.onmessage({
    stage: "bootloader",
    detail: "Helper USB interface opened; bulk OUT endpoint 0x02",
    completed: null,
    total: null,
    cancellable: false,
    diagnostic: true,
  });
  assert.equal(getInstallationState(), progress);
  assert.ok(getSessionLog().at(-1).includes("Helper USB interface opened"));
  assert.equal(getInstallationState().complete, false);
  finish({ backup_path: "/app-data/backups/device/run" });
  await setImmediate();
  assert.equal(getInstallationState().complete, true);
  assert.equal(getInstallationState().running, false);
  const completed = getInstallationState();
  channel.onmessage({ stage: "backup", detail: "late" });
  assert.equal(getInstallationState(), completed);

  mockIPC(() => Promise.reject("Readback failed"));
  startInstallation(firmware, "package-hash");
  const current = getInstallationState();
  channel.onmessage({ stage: "backup", detail: "old job" });
  assert.equal(getInstallationState(), current);
  await setImmediate();
  assert.equal(getInstallationState().complete, false);
  assert.equal(getInstallationState().error, "Readback failed");
});

test("cancellation waits for cleanup and is disabled during NOR installation", async () => {
  let reject;
  let channel;
  let cancels = 0;
  mockIPC((command, args) => {
    if (command === "cancel_install") {
      cancels++;
      return;
    }
    channel = args.onEvent;
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  startInstallation(firmware, "package-hash");
  await cancelInstallation();
  assert.equal(cancels, 1);
  assert.equal(getInstallationState().running, true);
  assert.equal(getInstallationState().cancelling, true);
  reject("Installation cancelled.");
  await setImmediate();
  assert.equal(getInstallationState().complete, false);
  startInstallation(firmware, "package-hash");
  channel.onmessage({
    stage: "bootloader",
    detail: "Installing",
    completed: null,
    total: null,
    cancellable: false,
  });
  await cancelInstallation();
  assert.equal(cancels, 1);
  reject("DFU transfer failed");
  await setImmediate();
});

test("channel creation failure stops the job and allows retry", async () => {
  mockIPC(() => undefined);
  window.__TAURI_INTERNALS__.transformCallback = () => {
    throw new Error("Channel unavailable");
  };
  startInstallation(firmware, "package-hash");
  await setImmediate();
  assert.equal(getInstallationState().running, false);
  assert.match(getInstallationState().error, /Channel unavailable/);
});
