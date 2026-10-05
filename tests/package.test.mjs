import assert from "node:assert/strict";
import { test } from "node:test";
import { mockIPC } from "@tauri-apps/api/mocks";
import { preparePackage } from "../src/lib/package.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;

test("package preparation binds automatic and local choices to the selected IPSW", async () => {
  for (const localPackage of [null, { digest: "local-hash" }]) {
    mockIPC((command, args) => {
      assert.equal(command, "prepare_package");
      assert.deepEqual(args, {
        firmwareSha256: "ipsw-hash",
        localDigest: localPackage?.digest ?? null,
      });
      return { digest: "ready-hash" };
    });
    assert.deepEqual(await preparePackage("ipsw-hash", localPackage), { digest: "ready-hash" });
  }
});
