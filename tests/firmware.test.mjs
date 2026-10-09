import assert from "node:assert/strict";
import { test } from "node:test";
import { mockIPC } from "@tauri-apps/api/mocks";
import { chooseFirmware } from "../src/lib/installation.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;

test("reports the selected filename before validation finishes", async () => {
  let finish;
  let channel;
  mockIPC((command, args) => {
    assert.equal(command, "choose_firmware");
    channel = args.onSelected;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  let filename = "";
  let validated = false;
  const pending = chooseFirmware((name) => {
    filename = name;
  }).then((result) => {
    validated = true;
    return result;
  });
  channel.onmessage("firmware.ipsw");
  assert.equal(filename, "firmware.ipsw");
  assert.equal(validated, false);
  const firmware = { filename, version: "2.0.5", sha256: "firmware-hash" };
  finish(firmware);
  assert.deepEqual(await pending, firmware);
});

test("cancelled selection emits no filename and invalid firmware rejects validation", async () => {
  const selections = [];
  mockIPC(() => null);
  assert.equal(await chooseFirmware((name) => selections.push(name)), null);
  assert.deepEqual(selections, []);

  mockIPC((_, args) => {
    args.onSelected.onmessage("incompatible.ipsw");
    return Promise.reject("Unsupported IPSW");
  });
  await assert.rejects(
    chooseFirmware((name) => selections.push(name)),
    (error) => error === "Unsupported IPSW",
  );
  assert.deepEqual(selections, ["incompatible.ipsw"]);
});

test("late filename notifications cannot restart validation after failure or success", async () => {
  let channel;
  const selections = [];
  mockIPC((_, args) => {
    channel = args.onSelected;
    return Promise.reject("Choose iPod_38.2.0.5.ipsw (Apple 2.0.5).");
  });
  await assert.rejects(chooseFirmware((name) => selections.push(name)));
  const failedChannel = channel;
  failedChannel.onmessage("incompatible.ipsw");
  assert.deepEqual(selections, []);

  const firmware = { filename: "iPod_38.2.0.5.ipsw", version: "2.0.5", sha256: "hash" };
  mockIPC((_, args) => {
    channel = args.onSelected;
    return firmware;
  });
  assert.deepEqual(await chooseFirmware((name) => selections.push(name)), firmware);
  channel.onmessage(firmware.filename);
  failedChannel.onmessage("incompatible.ipsw");
  assert.deepEqual(selections, []);
});
