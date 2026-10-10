import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createMockBackend } from "../src/dev/mockBackend.ts";
import { findScenario, scenarios } from "../src/dev/scenarios.ts";
import { installDevelopmentBackend } from "../src/lib/backend.ts";

const immediate = async () => undefined;

test("USB setup scenarios gate continuation and never request real authentication", async () => {
  const ready = createMockBackend(findScenario("usb-setup-ready"), immediate);
  assert.equal(await ready.invoke("usb_permissions_ready"), true);
  for (const id of ["full-setup", "usb-setup"]) {
    const setup = createMockBackend(findScenario(id), immediate);
    assert.equal(await setup.invoke("usb_permissions_ready"), false, id);
    await setup.invoke("enable_usb_access");
    assert.equal(await setup.invoke("usb_permissions_ready"), true, id);
  }
  const denied = createMockBackend(findScenario("usb-setup-denied"), immediate);
  await assert.rejects(denied.invoke("enable_usb_access"), /cancelled/);
  assert.equal(await denied.invoke("usb_permissions_ready"), false);
  await denied.invoke("enable_usb_access");
  assert.equal(await denied.invoke("usb_permissions_ready"), true);
});

test("USB setup covers unavailable authentication and recovery after a failed check", async () => {
  const unavailable = createMockBackend(findScenario("usb-setup-unavailable"), immediate);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(unavailable.invoke("enable_usb_access"), /authentication is unavailable/);
    assert.equal(await unavailable.invoke("usb_permissions_ready"), false);
  }
  const failedCheck = createMockBackend(findScenario("usb-setup-check-error"), immediate);
  await assert.rejects(failedCheck.invoke("usb_permissions_ready"), /Could not check/);
  await failedCheck.invoke("enable_usb_access");
  assert.equal(await failedCheck.invoke("usb_permissions_ready"), true);
});

test("USB setup previews can stay pending without granting access", async () => {
  for (const [id, command] of [
    ["usb-setup-checking", "usb_permissions_ready"],
    ["usb-setup-waiting", "enable_usb_access"],
  ]) {
    const backend = createMockBackend(findScenario(id), immediate);
    let settled = false;
    void backend.invoke(command).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, id);
    if (command === "enable_usb_access")
      assert.equal(await backend.invoke("usb_permissions_ready"), false);
  }
});

function capture(backend) {
  const events = [];
  const channel = backend.createChannel();
  channel.onmessage = (event) => events.push(event);
  return { events, channel };
}

test("scenario selection is deterministic and unknown commands never reach native IPC", async () => {
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length);
  assert.equal(findScenario(null).id, "unsupported-model");
  const backend = createMockBackend(findScenario(null), immediate);
  await assert.rejects(backend.invoke("unexpected_device_command"), /Unimplemented simulated/);
  assert.throws(() => installDevelopmentBackend(backend), /development build/);
});

test("every check scenario emits the same outcome returned in its report", async () => {
  for (const scenario of scenarios.filter((item) => item.screen === "checks")) {
    const backend = createMockBackend(scenario, immediate);
    const { channel, events } = capture(backend);
    const report = await backend.invoke("check_device", { onEvent: channel });
    assert.equal(report.compatible, !scenario.checkFailure, scenario.id);
    assert.deepEqual(report.issue, scenario.issue ?? null);
    assert.equal(report.cleanup.state, scenario.cleanupFailure ? "failed" : "idle");
    for (const check of report.checks) {
      assert.deepEqual(events.filter((event) => event.id === check.id).at(-1), {
        event: "check",
        ...check,
      });
    }
    if (scenario.checkFailure) {
      assert.equal(
        report.checks.find((check) => check.status === "failed").detail,
        scenario.checkFailure.detail,
      );
    }
  }
});

test("connection scenarios cover absent, non-DFU, multiple and inaccessible devices", async () => {
  for (const [id, count, dfu] of [
    ["no-device", 0, false],
    ["not-dfu", 1, false],
    ["multiple-devices", 2, true],
  ]) {
    const backend = createMockBackend(findScenario(id), immediate);
    const devices = await backend.invoke("discover_devices");
    assert.equal(devices.length, count);
    assert.equal(
      devices.some((device) => device.dfu_candidate),
      dfu,
    );
  }
  const backend = createMockBackend(findScenario("discovery-denied"), immediate);
  await assert.rejects(backend.invoke("discover_devices"), /access denied/);
});

test("firmware and package failures reject through their service commands", async () => {
  for (const scenario of scenarios.filter((item) => item.firmwareError || item.packageError)) {
    const backend = createMockBackend(scenario, immediate);
    if (scenario.firmwareError) {
      const { channel, events } = capture(backend);
      await assert.rejects(backend.invoke("choose_firmware", { onSelected: channel }), {
        message: scenario.firmwareError,
      });
      assert.equal(events.length, 1);
    } else {
      for (const command of ["prepare_package", "choose_local_package"]) {
        await assert.rejects(backend.invoke(command), { message: scenario.packageError });
      }
    }
  }
});

test("installation scenarios report progress, failures, success and cancellation", async () => {
  for (const scenario of scenarios.filter((item) => item.screen === "installation")) {
    const backend = createMockBackend(scenario, immediate);
    const { channel, events } = capture(backend);
    const pending = backend.invoke("install", { onEvent: channel });
    if (scenario.installFailure) {
      await assert.rejects(pending, { message: scenario.installFailure.detail });
      assert.ok(events.every((event) => event.stage !== "bootloader"));
    } else {
      assert.match((await pending).backup_path, /Simulated/);
      assert.equal(events.at(-1).cancellable, false);
    }
    assert.ok(events.some((event) => event.completed === 50));
  }
  const backend = createMockBackend(findScenario("installation-success"), immediate);
  const { channel } = capture(backend);
  const pending = backend.invoke("install", { onEvent: channel });
  await backend.invoke("cancel_install");
  await assert.rejects(pending, /cancelled/);
  assert.match((await backend.invoke("install", { onEvent: channel })).backup_path, /Simulated/);
});

test("update scenarios cover availability, manual mode, failures and simulated restart", async () => {
  for (const scenario of scenarios.filter((item) => item.update)) {
    const backend = createMockBackend(scenario, immediate);
    if (scenario.update === "check-error") {
      await assert.rejects(backend.invoke("check_installer_update"), /Could not check/);
      continue;
    }
    const info = await backend.invoke("check_installer_update");
    assert.equal(info.mode, scenario.update === "manual" ? "manual" : "automatic");
    assert.equal(info.version, scenario.update === "current" ? null : "0.1.2");
    if (scenario.startUpdate) {
      const { channel, events } = capture(backend);
      const pending = backend.invoke("install_installer_update", { onEvent: channel });
      if (scenario.update === "download-error") await assert.rejects(pending, /Could not download/);
      else {
        await pending;
        assert.equal(events.at(-1).stage, "installing");
      }
    }
    await backend.invoke("open_installer_download");
  }
});

test("application services route native commands through the shared backend", async () => {
  const root = new URL("../src/", import.meta.url);
  const files = (await readdir(root, { recursive: true })).map((file) =>
    file.replaceAll("\\", "/"),
  );
  for (const file of files.filter(
    (file) => /\.(ts|tsx)$/.test(file) && file !== "lib/backend.ts",
  )) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /from ["']@tauri-apps\//, file);
  }
});
