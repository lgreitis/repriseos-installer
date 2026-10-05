import type { EventChannel } from "../lib/backend.ts";
import type { InstallEvent } from "../lib/installation.ts";
import type { UpdateProgress } from "../lib/updates.ts";
import type { Wait } from "./checks.ts";
import type { Scenario } from "./scenarios.ts";

const stages = [
  ["storage", "Checking storage"],
  ["backup", "Backing up boot firmware"],
  ["decrypt", "Preparing Apple firmware"],
  ["assemble", "Preparing RepriseOS"],
  ["uploadLoader", "Uploading companion loader"],
  ["uploadOsos", "Uploading RepriseOS"],
  ["verify", "Verifying RepriseOS"],
  ["bootloader", "Sending bootloader installer"],
] as const;

export async function simulateInstallation(
  scenario: Scenario,
  channel: EventChannel<InstallEvent>,
  wait: Wait,
  cancelled: () => boolean,
) {
  for (const [stage, detail] of stages) {
    for (const completed of [0, 25, 50, 75, 100]) {
      channel.onmessage({
        stage: stage === "verify" ? "uploadOsos" : stage,
        detail,
        completed,
        total: 100,
        cancellable: stage !== "bootloader",
      });
      await wait();
      if (cancelled()) throw new Error("Installation cancelled. Return to DFU mode to try again.");
      if (scenario.installFailure?.stage === stage && completed === 50) {
        throw new Error(scenario.installFailure.detail);
      }
    }
  }
  return { backup_path: "Simulated backup (no files written)" };
}

export async function simulateUpdate(
  scenario: Scenario,
  channel: EventChannel<UpdateProgress>,
  wait: Wait,
) {
  for (let downloaded = 0; downloaded <= 100; downloaded += 10) {
    channel.onmessage({ stage: "downloading", downloaded, total: 100 });
    await wait();
    if (scenario.update === "download-error" && downloaded === 50) {
      throw new Error(
        "Could not download the installer update. Check your connection and try again.",
      );
    }
  }
  channel.onmessage({ stage: "installing", downloaded: 100, total: 100 });
}
