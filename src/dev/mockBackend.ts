import type { Backend, EventChannel } from "../lib/backend.ts";
import { simulateChecks, type Wait } from "./checks.ts";
import { mockDevice, mockFirmware, mockPackage } from "./fixtures.ts";
import { simulateInstallation, simulateUpdate } from "./progress.ts";
import type { Scenario } from "./scenarios.ts";

function channel<T>(args: Record<string, unknown>, name = "onEvent"): EventChannel<T> {
  const value = args[name] as EventChannel<T> | undefined;
  if (typeof value?.onmessage !== "function") throw new Error(`Missing mock channel: ${name}`);
  return value;
}

export function createMockBackend(
  scenario: Scenario,
  wait: Wait = () => new Promise((resolve) => setTimeout(resolve, 250)),
): Backend {
  let cancelled = false;

  async function handle(command: string, args: Record<string, unknown>) {
    switch (command) {
      case "discover_devices":
        if (scenario.discovery === "denied")
          throw new Error("USB discovery failed: access denied.");
        if (scenario.discovery === "absent") return [];
        if (scenario.discovery === "normal") return [{ ...mockDevice, dfu_candidate: false }];
        if (scenario.discovery === "multiple")
          return [mockDevice, { ...mockDevice, selector: { bus: 1, address: 2 } }];
        return [mockDevice];
      case "check_device":
        return simulateChecks(scenario, channel(args), wait);
      case "choose_firmware":
        channel<string>(args, "onSelected").onmessage(mockFirmware.filename);
        await wait();
        if (scenario.firmwareError) throw new Error(scenario.firmwareError);
        return mockFirmware;
      case "choose_local_package":
      case "prepare_package":
        await wait();
        if (scenario.packageError) throw new Error(scenario.packageError);
        return {
          ...mockPackage,
          filename: command === "choose_local_package" ? "repriseos.zip" : null,
        };
      case "install":
        cancelled = false;
        return simulateInstallation(scenario, channel(args), wait, () => cancelled);
      case "cancel_install":
        cancelled = true;
        return;
      case "check_installer_update":
        await wait();
        if (scenario.update === "check-error")
          throw new Error(
            "Could not check for updates. Check your internet connection and try again.",
          );
        return {
          current_version: "0.1.1",
          version: scenario.update && scenario.update !== "current" ? "0.1.2" : null,
          mode: scenario.update === "manual" ? "manual" : "automatic",
        };
      case "install_installer_update":
        return simulateUpdate(scenario, channel(args), wait);
      case "open_installer_download":
        return;
      default:
        throw new Error(`Unimplemented simulated command: ${command}`);
    }
  }

  return {
    invoke: async <T>(command: string, args: Record<string, unknown> = {}) =>
      (await handle(command, args)) as T,
    createChannel: <T>() => ({ onmessage: (_message: T) => undefined }),
  };
}
