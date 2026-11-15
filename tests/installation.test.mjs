import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  cancelInstallation,
  failureMessage,
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
  finish({
    backup_path: "/app-data/backups/device/run",
    operation: "install",
    outcome: "installer_sent",
  });
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
  assert.equal(getInstallationState().failure.detail, "Readback failed");
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

test("disk-only update logs its outcome without claiming a bootloader install", async () => {
  mockIPC((command) => {
    assert.equal(command, "install");
    return { backup_path: "/backups/update", operation: "update", outcome: "files_updated" };
  });
  const first = getSessionLog().length;
  startInstallation(firmware, "package-hash");
  await setImmediate();
  assert.equal(getInstallationState().complete, true);
  assert.equal(getInstallationState().outcome, "files_updated");
  const log = getSessionLog().slice(first).join("\n");
  assert.match(log, /UPDATE COMPLETE/);
  assert.match(log, /bootloader unchanged; restart requested/);
  assert.doesNotMatch(log, /BOOTLOADER HANDOFF/);
});

test("channel creation failure stops the job and allows retry", async () => {
  mockIPC(() => undefined);
  window.__TAURI_INTERNALS__.transformCallback = () => {
    throw new Error("Channel unavailable");
  };
  startInstallation(firmware, "package-hash");
  await setImmediate();
  assert.equal(getInstallationState().running, false);
  assert.match(getInstallationState().failure.detail, /Channel unavailable/);
});

test("failure message says what happened, what changed and how to go on", () => {
  const failure = (fields) => ({
    detail: "full log text",
    error: "Not enough free space on the iPod",
    stage: "storage",
    device_stopped: false,
    kept_percent: null,
    cancelled: false,
    ...fields,
  });
  const message = (fields) => failureMessage(failure(fields));
  const retry = (cause, next) => ({ cause, next, retry: true });
  const stop = (cause, next = null) => ({ cause, next, retry: false });
  assert.deepEqual(
    message({ stage: "decrypt", device_stopped: true, kept_percent: 30 }),
    retry(
      "Your iPod stopped responding. Nothing on it was changed. Decryption progress (30%) is saved.",
      "Put your iPod back into DFU mode to continue.",
    ),
  );
  assert.deepEqual(
    message({ stage: "decrypt", device_stopped: true, kept_percent: 0 }),
    retry(
      "Your iPod stopped responding. Nothing on it was changed. Decryption progress is saved.",
      "Put your iPod back into DFU mode to continue.",
    ),
  );
  // Kept progress alone does not make a failure retryable.
  assert.deepEqual(
    message({ stage: "decrypt", error: "Could not write the log", kept_percent: 30 }),
    stop("Could not write the log. Nothing on it was changed. Decryption progress (30%) is saved."),
  );
  assert.deepEqual(
    message({ stage: "decrypt", error: "Cached firmware is invalid" }),
    stop("Cached firmware is invalid. Nothing on it was changed."),
  );
  assert.deepEqual(
    message({ stage: null, error: "Could not save result.json." }),
    stop("Could not save result.json."),
  );
  assert.deepEqual(
    message({}),
    stop("Not enough free space on the iPod. Nothing on it was changed."),
  );
  assert.deepEqual(
    message({ stage: "uploadOsos", device_stopped: true }),
    retry("Your iPod stopped responding.", "Put your iPod back into DFU mode to try again."),
  );
  // A refused write leaves the iPod out of DFU mode.
  assert.deepEqual(
    message({ stage: "uploadOsos", error: "Upload helper refused the file" }),
    stop(
      "Upload helper refused the file.",
      "Put your iPod back into DFU mode before you try again.",
    ),
  );
  // DFU mode must not interrupt a bootloader install.
  for (const stage of ["bootloader", "restart"]) {
    assert.deepEqual(
      message({ stage, device_stopped: true }),
      stop(
        "Your iPod stopped responding.",
        "Leave your iPod connected and wait for it to restart before you disconnect it or try again.",
      ),
    );
  }
  assert.deepEqual(
    message({ stage: "uploadOsos", device_stopped: true, cancelled: true }),
    stop("You cancelled the installation."),
  );
});
