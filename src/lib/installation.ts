import { backendAvailable, createChannel, invoke } from "./backend.ts";
import { errorDetail } from "./errors.ts";
import { appendSessionLog, getSessionLog } from "./sessionLog.ts";

export interface FirmwareInfo {
  filename: string;
  version: string;
  sha256: string;
}

export async function chooseFirmware(
  onSelected: (filename: string) => void,
): Promise<FirmwareInfo | null> {
  if (!backendAvailable()) return Promise.reject("Open the desktop installer to select firmware.");
  const channel = createChannel<string>();
  channel.onmessage = onSelected;
  try {
    return await invoke<FirmwareInfo | null>("choose_firmware", { onSelected: channel });
  } finally {
    // Channel notifications can arrive after the command result.
    channel.onmessage = () => {};
  }
}

export async function cachedFirmware(): Promise<FirmwareInfo | null> {
  if (!backendAvailable()) return null;
  return invoke<FirmwareInfo | null>("cached_firmware");
}

export interface InstallEvent {
  stage: string;
  detail: string;
  completed: number | null;
  total: number | null;
  cancellable: boolean;
  diagnostic?: boolean;
}

const labels: Record<string, string> = {
  prepare: "Preparing installation",
  storage: "Checking storage",
  checkBootloader: "Checking installed bootloader",
  backup: "Backing up boot firmware",
  decrypt: "Preparing Apple firmware",
  assemble: "Preparing RepriseOS",
  uploadDefaultTheme: "Uploading stock artwork",
  uploadDarkTheme: "Uploading Dark Mode artwork",
  uploadLoader: "Uploading companion loader",
  uploadOsos: "Uploading RepriseOS",
  bootloader: "Preparing bootloader installer",
  restart: "Restarting iPod",
};

interface InstallationState {
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  event: InstallEvent;
  error: string | null;
  complete: boolean;
  cancelling: boolean;
  outcome: "installer_sent" | "files_updated" | null;
}

let state: InstallationState = {
  running: false,
  startedAt: 0,
  finishedAt: null,
  event: { stage: "prepare", detail: "", completed: null, total: null, cancellable: true },
  error: null,
  complete: false,
  cancelling: false,
  outcome: null,
};
const listeners = new Set<() => void>();
const publish = (next: InstallationState) => {
  state = next;
  for (const listener of listeners) listener();
};
export const getInstallationState = () => state;
export function subscribeToInstallation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function installationLabel(event: InstallEvent) {
  if (event.stage === "storage") return labels.storage;
  return event.detail || labels[event.stage];
}

let nextJobId = 0;

export function startInstallation(firmware: FirmwareInfo, packageDigest: string) {
  if (state.running) return;
  publish({
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    event: { stage: "prepare", detail: "", completed: null, total: null, cancellable: true },
    error: null,
    complete: false,
    cancelling: false,
    outcome: null,
  });
  appendSessionLog("Install/update started; checking device state to select the operation.");
  const jobId = ++nextJobId;
  let lastDetail = "";
  const run = async () => {
    if (!backendAvailable()) throw new Error("Open the desktop installer to install RepriseOS.");
    const channel = createChannel<InstallEvent>();
    channel.onmessage = (event) => {
      if (!state.running || jobId !== nextJobId) return;
      if (event.diagnostic) {
        appendSessionLog(`${event.stage}: ${event.detail}`);
        return;
      }
      if (event.detail !== lastDetail) {
        appendSessionLog(`${event.stage}: ${event.detail}`);
        lastDetail = event.detail;
      }
      publish({ ...state, event });
    };
    return invoke<{
      backup_path: string;
      outcome: "installer_sent" | "files_updated";
      operation: "install" | "update";
    }>("install", {
      firmwareSha256: firmware.sha256,
      packageDigest,
      onEvent: channel,
    });
  };
  void run()
    .then((result) => {
      const completion =
        result.outcome === "files_updated"
          ? "COMPLETE: disk files verified; bootloader unchanged; restart requested; boot not verified."
          : "BOOTLOADER HANDOFF: disk files verified; bootloader installer sent; NOR completion not read back.";
      appendSessionLog(
        `${result.operation.toUpperCase()} ${completion} Backups and logs: ${result.backup_path}`,
      );
      publish({
        ...state,
        running: false,
        complete: true,
        outcome: result.outcome,
        finishedAt: Date.now(),
      });
    })
    .catch((error: unknown) => {
      const detail = errorDetail(error);
      appendSessionLog(`Installation stopped: ${detail}`);
      publish({ ...state, running: false, error: detail, finishedAt: Date.now() });
    });
}

export async function cancelInstallation() {
  if (!state.running || !state.event.cancellable || state.cancelling) return;
  publish({ ...state, cancelling: true });
  try {
    await invoke("cancel_install");
    appendSessionLog("Cancellation requested; finishing the current file operation.");
  } catch (error) {
    appendSessionLog(`Cancellation failed: ${errorDetail(error)}`);
    publish({ ...state, cancelling: false });
  }
}

export async function saveDebugZip(): Promise<string | null> {
  return invoke<string | null>("save_debug_zip", {
    sessionLog: getSessionLog().join("\n"),
    preview: false,
  });
}

export function formatElapsedTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
