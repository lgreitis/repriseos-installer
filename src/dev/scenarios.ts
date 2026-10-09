import type { Screen } from "../App";
import type { CheckId, CompatibilityIssue } from "../lib/deviceChecks.ts";

export interface Scenario {
  id: string;
  group: string;
  label: string;
  screen: Screen;
  hint?: string;
  discovery?: "absent" | "multiple" | "normal" | "denied";
  checkFailure?: { id: CheckId; detail: string; model?: string; version?: string };
  issue?: CompatibilityIssue;
  cleanupFailure?: string;
  firmwareError?: string;
  localPackage?: boolean;
  packageError?: string;
  installFailure?: { stage: string; detail: string };
  update?: "available" | "manual" | "current" | "check-error" | "download-error" | "installing";
  startUpdate?: boolean;
}

export const scenarios: Scenario[] = [
  { id: "full-setup", group: "Setup", label: "Successful setup", screen: "main" },
  {
    id: "unsupported-model",
    group: "Compatibility",
    label: "Unsupported model",
    screen: "checks",
    issue: { kind: "unsupported_model", model: "MA002" },
    checkFailure: {
      id: "model",
      model: "MA002",
      detail: "MA002; HwVr 0x000b0000 (unsupported target)",
    },
  },
  {
    id: "package-mismatch",
    group: "Compatibility",
    label: "Wrong package for iPod",
    screen: "checks",
    issue: { kind: "package_mismatch", model: "MC293" },
    checkFailure: {
      id: "version",
      detail:
        "The selected firmware package does not support this MC293 iPod. Choose a compatible Classic package.",
    },
  },
  { id: "checks-passed", group: "Compatibility", label: "All checks passed", screen: "checks" },
  { id: "no-device", group: "Connection", label: "No iPod", screen: "dfu", discovery: "absent" },
  {
    id: "multiple-devices",
    group: "Connection",
    label: "Multiple iPods",
    screen: "dfu",
    discovery: "multiple",
  },
  {
    id: "not-dfu",
    group: "Connection",
    label: "iPod outside DFU",
    screen: "dfu",
    discovery: "normal",
  },
  {
    id: "discovery-denied",
    group: "Connection",
    label: "Discovery access denied",
    screen: "dfu",
    discovery: "denied",
  },
  {
    id: "usb-denied",
    group: "Connection",
    label: "USB permission denied",
    screen: "checks",
    checkFailure: {
      id: "access",
      detail: "USB access denied. Close other iPod tools and check the USB driver, then try again.",
    },
  },
  {
    id: "disconnected",
    group: "Connection",
    label: "Disconnected during checks",
    screen: "checks",
    checkFailure: {
      id: "rom",
      detail: "The iPod disconnected. Return to the DFU guide and reconnect it.",
    },
  },
  {
    id: "cleanup-failed",
    group: "Connection",
    label: "DFU cleanup failed",
    screen: "checks",
    cleanupFailure: "The iPod did not return to idle DFU. Reconnect your iPod in DFU mode.",
  },
  {
    id: "local-package",
    group: "Firmware and downloads",
    label: "Local package selected",
    screen: "firmware",
    localPackage: true,
    hint: "Continue with the local package, change it, or switch to automatic download.",
  },
  {
    id: "invalid-ipsw",
    group: "Firmware and downloads",
    label: "Unsupported IPSW",
    screen: "firmware",
    hint: "Choose file to simulate validation failure.",
    firmwareError: "Choose iPod_38.2.0.5.ipsw (Apple 2.0.5).",
  },
  {
    id: "download-offline",
    group: "Firmware and downloads",
    label: "Package download failed",
    screen: "firmware",
    hint: "Continue to simulate the package download.",
    packageError:
      "Could not download the firmware package. Check your internet connection and try again.",
  },
  {
    id: "release-incompatible",
    group: "Firmware and downloads",
    label: "Installer too old",
    screen: "firmware",
    hint: "Continue to check release compatibility.",
    packageError:
      "This firmware release requires installer 0.2.0 or newer. Update RepriseOS Installer, then try again.",
  },
  {
    id: "signature-invalid",
    group: "Firmware and downloads",
    label: "Invalid package signature",
    screen: "firmware",
    hint: "Continue or choose a local package to simulate verification failure.",
    packageError: "Firmware manifest signature verification failed.",
  },
  {
    id: "installation-success",
    group: "Installation",
    label: "Progress to success",
    screen: "installation",
  },
  {
    id: "storage-full",
    group: "Installation",
    label: "Not enough space",
    screen: "installation",
    installFailure: {
      stage: "storage",
      detail: "Not enough free space on the iPod. Free some space, then try again.",
    },
  },
  {
    id: "transfer-failed",
    group: "Installation",
    label: "USB transfer failed",
    screen: "installation",
    installFailure: {
      stage: "uploadOsos",
      detail:
        "USB transfer failed: device disconnected. Reconnect your iPod in DFU mode before trying again.",
    },
  },
  {
    id: "verification-failed",
    group: "Installation",
    label: "Readback verification failed",
    screen: "installation",
    installFailure: {
      stage: "verify",
      detail:
        "RepriseOS readback verification failed. The bootloader was not installed. Return to DFU mode and try again.",
    },
  },
  { id: "success", group: "Installation", label: "Success screen", screen: "success" },
  {
    id: "update-available",
    group: "App updates",
    label: "Update available",
    screen: "main",
    update: "available",
  },
  {
    id: "update-manual",
    group: "App updates",
    label: "Manual update available",
    screen: "main",
    update: "manual",
  },
  {
    id: "update-current",
    group: "App updates",
    label: "Up to date",
    screen: "main",
    update: "current",
    hint: "Check for updates to show the confirmation.",
  },
  {
    id: "update-check-error",
    group: "App updates",
    label: "Update check failed",
    screen: "main",
    update: "check-error",
  },
  {
    id: "update-download",
    group: "App updates",
    label: "Downloading and installing",
    screen: "main",
    update: "installing",
    startUpdate: true,
    hint: "Stops at installing; no application restart occurs.",
  },
  {
    id: "update-download-error",
    group: "App updates",
    label: "Update download failed",
    screen: "main",
    update: "download-error",
    startUpdate: true,
  },
];

export function findScenario(id: string | null): Scenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[1];
}
