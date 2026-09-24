import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { errorDetail } from "./deviceChecks.ts";
import { appendSessionLog } from "./sessionLog.ts";

export interface FirmwareInfo {
  filename: string;
  version: string;
  sha256: string;
}

export function chooseFirmware(
  onSelected: (filename: string) => void,
): Promise<FirmwareInfo | null> {
  if (!isTauri()) return Promise.reject("Open the desktop installer to select firmware.");
  const channel = new Channel<string>();
  channel.onmessage = onSelected;
  return invoke("choose_firmware", { onSelected: channel });
}

export interface InstallEvent {
  stage: string;
  detail: string;
  completed: number | null;
  total: number | null;
  cancellable: boolean;
}

const labels: Record<string, string> = {
  prepare: "Preparing installation",
  storage: "Checking storage",
  backup: "Backing up boot firmware",
  decrypt: "Preparing Apple firmware",
  assemble: "Preparing RepriseOS",
  uploadLoader: "Uploading companion loader",
  uploadOsos: "Uploading RepriseOS",
  bootloader: "Preparing bootloader installer",
};

interface InstallationState {
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  event: InstallEvent;
  error: string | null;
  complete: boolean;
  cancelling: boolean;
}

let state: InstallationState = {
  running: false,
  startedAt: 0,
  finishedAt: null,
  event: { stage: "prepare", detail: "", completed: null, total: null, cancellable: true },
  error: null,
  complete: false,
  cancelling: false,
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
  });
  appendSessionLog("Installation started.");
  const jobId = ++nextJobId;
  let lastDetail = "";
  const run = async () => {
    if (!isTauri()) throw new Error("Open the desktop installer to install RepriseOS.");
    const channel = new Channel<InstallEvent>();
    channel.onmessage = (event) => {
      if (!state.running || jobId !== nextJobId) return;
      if (event.detail !== lastDetail) {
        appendSessionLog(`${event.stage}: ${event.detail}`);
        lastDetail = event.detail;
      }
      publish({ ...state, event });
    };
    return invoke<{ backup_path: string }>("install", {
      firmwareSha256: firmware.sha256,
      packageDigest,
      onEvent: channel,
    });
  };
  void run()
    .then((result) => {
      appendSessionLog(`Bootloader installer sent. Backups: ${result.backup_path}`);
      publish({ ...state, running: false, complete: true, finishedAt: Date.now() });
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

export function formatElapsedTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
