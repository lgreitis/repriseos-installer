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
  saveDebug?: (sessionLog: string) => Promise<string | null>,
): Backend {
  let cancelled = false;
  let checkId = 0;
  let overrideAvailable = false;
  let usbReady = !scenario.usbSetup;
  let usbAttempts = 0;

  async function handle(command: string, args: Record<string, unknown>) {
    switch (command) {
      case "usb_permissions_ready":
        if (scenario.usbSetup === "checking") return new Promise<never>(() => {});
        if (scenario.usbSetup === "check-error" && !usbReady)
          throw new Error("Could not check USB access setup.");
        return usbReady;
      case "enable_usb_access":
        usbAttempts += 1;
        if (scenario.usbSetup === "waiting") return new Promise<never>(() => {});
        await wait();
        if (scenario.usbSetup === "unavailable") {
          throw new Error(
            "Administrator authentication is unavailable or was denied. Make sure polkit and a desktop authentication agent are installed and running, then try again.",
          );
        }
        if (scenario.usbSetup === "denied" && usbAttempts === 1)
          throw new Error(
            "Administrator authentication was cancelled. Try again to enable iPod access.",
          );
        usbReady = true;
        return;
      case "discover_devices":
        if (scenario.discovery === "denied")
          throw new Error("USB discovery failed: access denied.");
        if (scenario.discovery === "absent") return [];
        if (scenario.discovery === "normal") return [{ ...mockDevice, dfu_candidate: false }];
        if (scenario.discovery === "multiple")
          return [mockDevice, { ...mockDevice, selector: { bus: 1, address: 2 } }];
        return [mockDevice];
      case "check_device": {
        const approved = args.allowUnknownHardware !== undefined;
        const eligible = overrideAvailable && args.allowUnknownHardware === checkId;
        overrideAvailable = false;
        checkId += 1;
        if (approved && !eligible)
          throw new Error("Device or package changed. Run device checks again.");
        const report = await simulateChecks(
          approved ? { ...scenario, checkFailure: undefined, issue: undefined } : scenario,
          channel(args),
          wait,
        );
        if (approved && report.identity) {
          report.identity.model = scenario.checkFailure?.model ?? report.identity.model;
          const model = report.checks.find((check) => check.id === "model");
          if (model) model.detail = "Experimental hardware override accepted";
        }
        overrideAvailable =
          report.issue?.kind === "unknown_hardware" && report.cleanup.state === "idle";
        return { ...report, check_id: checkId, hardware_override: approved };
      }
      case "cached_firmware":
        return null;
      case "choose_firmware":
        channel<string>(args, "onSelected").onmessage(mockFirmware.filename);
        await wait();
        if (scenario.firmwareError) throw new Error(scenario.firmwareError);
        return mockFirmware;
      case "choose_local_package":
      case "prepare_package":
        overrideAvailable = false;
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
      case "save_debug_zip":
        if (scenario.debugExport === "cancel") return null;
        if (scenario.debugExport === "error") throw new Error("Destination is not writable.");
        if (saveDebug) return saveDebug(String(args.sessionLog ?? ""));
        throw new Error("Native debug export is unavailable in this preview.");
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
      case "plugin:opener|open_url":
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
