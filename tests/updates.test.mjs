import assert from "node:assert/strict";
import { test } from "node:test";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  checkInstallerUpdate,
  dismissUpdate,
  getUpdateState,
  installInstallerUpdate,
  openInstallerDownload,
  updateIsBusy,
} from "../src/lib/updates.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;
const available = { current_version: "0.1.1", version: "0.1.2", mode: "automatic" };

test("automatic updates serialize requests, report progress and recover from failure", async () => {
  let finishCheck;
  let checks = 0;
  mockIPC((command) => {
    assert.equal(command, "check_installer_update");
    checks++;
    return new Promise((resolve) => {
      finishCheck = resolve;
    });
  });
  const checking = checkInstallerUpdate();
  await checkInstallerUpdate();
  assert.equal(checks, 1);
  finishCheck(available);
  await checking;
  assert.equal(getUpdateState().status, "available");
  dismissUpdate();
  assert.equal(getUpdateState().dismissed, true);

  let rejectInstall;
  let channel;
  let installs = 0;
  mockIPC((command, args) => {
    assert.equal(command, "install_installer_update");
    installs++;
    channel = args.onEvent;
    return new Promise((_, reject) => {
      rejectInstall = reject;
    });
  });
  const installing = installInstallerUpdate();
  await installInstallerUpdate();
  await checkInstallerUpdate();
  assert.equal(installs, 1);
  assert.equal(updateIsBusy(getUpdateState().status), true);
  channel.onmessage({ stage: "downloading", downloaded: 42, total: 100 });
  assert.equal(getUpdateState().progress, 42);
  channel.onmessage({ stage: "installing", downloaded: 100, total: 100 });
  assert.equal(getUpdateState().status, "installing");
  rejectInstall("Signature verification failed");
  await installing;
  assert.equal(getUpdateState().status, "error");
  assert.equal(getUpdateState().error, "Signature verification failed");
  channel.onmessage({ stage: "downloading", downloaded: 1, total: 100 });
  assert.equal(getUpdateState().status, "error");
});

test("manual and development modes never invoke installation", async () => {
  for (const mode of ["manual", "disabled"]) {
    const commands = [];
    mockIPC((command) => {
      commands.push(command);
      return { ...available, mode };
    });
    await checkInstallerUpdate();
    await installInstallerUpdate();
    assert.deepEqual(commands, ["check_installer_update"]);
    assert.equal(getUpdateState().dismissed, false);
    if (mode === "manual") {
      await openInstallerDownload();
      assert.equal(commands.at(-1), "open_installer_download");
    } else assert.equal(getUpdateState().status, "disabled");
  }
});

test("failed checks allow retries", async () => {
  mockIPC(() => Promise.reject("Offline"));
  await checkInstallerUpdate();
  assert.equal(getUpdateState().error, "Offline");
  mockIPC(() => ({ ...available, version: null }));
  await checkInstallerUpdate();
  assert.equal(getUpdateState().status, "current");
  assert.equal(getUpdateState().error, null);
});
