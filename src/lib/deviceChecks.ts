import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { appendSessionLog } from "./sessionLog.ts";

export interface DeviceSelector {
  bus: number;
  address: number;
}

export interface DeviceInfo {
  selector: DeviceSelector;
  port_path: number[];
  vendor_id: number;
  product_id: number;
  mode: string;
  dfu_candidate: boolean;
}

export const checkIds = ["usb", "access", "dfu", "rom", "model", "version"] as const;
export type CheckId = (typeof checkIds)[number];
export type CheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export interface Check {
  id: CheckId;
  status: CheckStatus;
  detail: string;
}

export interface CheckReport {
  checks: Check[];
  compatible: boolean;
  cleanup: { state: "not_attempted" | "idle" | "failed"; detail?: string };
  identity: { model: string; serial: string; recorded_firmware: string } | null;
}

type CheckEvent =
  | ({ event: "check" } & Check)
  | { event: "progress"; stage: CheckId; completed: number; total: number };

interface CheckState {
  jobId: number;
  device: DeviceInfo | null;
  reconnecting: boolean;
  replacement: DeviceInfo | null;
  running: boolean;
  checks: Check[];
  progress: { completed: number; total: number } | null;
  report: CheckReport | null;
  error: string | null;
}

let state: CheckState = {
  jobId: 0,
  device: null,
  reconnecting: false,
  replacement: null,
  running: false,
  checks: checkIds.map((id) => ({ id, status: "pending", detail: "" })),
  progress: null,
  report: null,
  error: null,
};
const listeners = new Set<() => void>();

function publish(next: CheckState) {
  state = next;
  for (const listener of listeners) listener();
}

export const getCheckState = () => state;
export function subscribeToChecks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "detail" in error) {
    return String(error.detail);
  }
  return String(error);
}

let discovery: Promise<DeviceInfo[]> | null = null;
export function discoverDevices(): Promise<DeviceInfo[]> {
  if (!isTauri()) return Promise.reject("Open the desktop installer to detect your iPod.");
  discovery ??= invoke<DeviceInfo[]>("discover_devices").finally(() => {
    discovery = null;
  });
  return discovery;
}

export function startDeviceChecks(device: DeviceInfo) {
  if (state.running || state.reconnecting) return;
  const jobId = state.jobId + 1;
  appendSessionLog(
    `Device check ${jobId}: started on USB bus ${device.selector.bus}, port ${device.port_path.join(".")}.`,
  );
  publish({
    jobId,
    device,
    reconnecting: false,
    replacement: null,
    running: true,
    checks: checkIds.map((id) => ({
      id,
      status: id === "usb" ? "running" : "pending",
      detail: "",
    })),
    progress: null,
    report: null,
    error: null,
  });
  const run = async () => {
    const channel = new Channel<CheckEvent>();
    channel.onmessage = (event) => {
      if (state.jobId !== jobId || !state.running) return;
      if (event.event === "check") {
        appendSessionLog(`${event.id}: ${event.status}${event.detail ? ` — ${event.detail}` : ""}`);
        publish({
          ...state,
          checks: state.checks.map((check) => (check.id === event.id ? event : check)),
        });
      } else if (event.stage === "rom") {
        publish({ ...state, progress: { completed: event.completed, total: event.total } });
      }
    };
    if (discovery) await discovery.catch(() => undefined);
    return invoke<CheckReport>("check_device", { selector: device.selector, onEvent: channel });
  };
  void run()
    .then((report) => {
      if (state.jobId !== jobId) return;
      const error =
        report.cleanup.state === "failed"
          ? `DFU cleanup failed: ${report.cleanup.detail ?? "Reconnect your iPod in DFU mode."}`
          : (report.checks.find((check) => check.status === "failed")?.detail ??
            (!report.compatible || report.cleanup.state !== "idle"
              ? "The iPod did not pass the checks."
              : null));
      for (const check of report.checks) {
        if (
          !state.checks.some(
            (previous) =>
              previous.id === check.id &&
              previous.status === check.status &&
              previous.detail === check.detail,
          )
        ) {
          appendSessionLog(`${check.id}: ${check.status} — ${check.detail}`);
        }
      }
      appendSessionLog(
        `DFU cleanup: ${report.cleanup.state}${report.cleanup.detail ? ` — ${report.cleanup.detail}` : ""}`,
      );
      appendSessionLog(
        error ? `Device checks stopped: ${error}` : "Device compatibility checks passed.",
      );
      publish({ ...state, running: false, checks: report.checks, report, error });
    })
    .catch((error: unknown) => {
      if (state.jobId !== jobId) return;
      appendSessionLog(`Device checks failed: ${errorDetail(error)}`);
      const stage =
        typeof error === "object" && error !== null && "stage" in error ? error.stage : "usb";
      const failedId = checkIds.find((id) => id === stage) ?? "usb";
      publish({
        ...state,
        running: false,
        error: errorDetail(error),
        checks: state.checks.map((check) => ({
          ...check,
          status: check.id === failedId ? "failed" : "skipped",
          detail: check.id === failedId ? errorDetail(error) : "A preceding check failed",
        })),
      });
    });
}

export async function retryDeviceChecks() {
  if (state.running || state.reconnecting || !state.device) return;
  const previous = state.device;
  appendSessionLog("Retry requested: looking for an iPod in DFU mode.");
  publish({ ...state, reconnecting: true, replacement: null });
  try {
    const devices = (await discoverDevices()).filter((device) => device.dfu_candidate);
    if (devices.length !== 1) {
      throw devices.length > 1
        ? "More than one iPod detected. Leave one connected, then try again."
        : "Reconnect your iPod in DFU mode, then try again.";
    }
    const device = devices[0];
    const sameLocation =
      device.selector.bus === previous.selector.bus &&
      device.selector.address === previous.selector.address &&
      device.port_path.join(".") === previous.port_path.join(".");
    publish({ ...state, reconnecting: false, replacement: sameLocation ? null : device });
    if (sameLocation) startDeviceChecks(device);
    else appendSessionLog("Reconnected iPod requires confirmation before checking.");
  } catch (error) {
    appendSessionLog(`Reconnection failed: ${errorDetail(error)}`);
    publish({ ...state, reconnecting: false, error: errorDetail(error) });
  }
}
