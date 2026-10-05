import { backendAvailable, createChannel, invoke } from "./backend.ts";
import { errorDetail } from "./deviceChecks.ts";

export interface UpdateInfo {
  current_version: string;
  version: string | null;
  mode: "automatic" | "manual" | "disabled";
}
export interface UpdateProgress {
  stage: "downloading" | "installing";
  downloaded: number;
  total: number | null;
}
export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installing"
    | "error"
    | "disabled";
  info: UpdateInfo | null;
  progress: number | null;
  error: string | null;
  dismissed: boolean;
}

let state: UpdateState = {
  status: "idle",
  info: null,
  progress: null,
  error: null,
  dismissed: false,
};
const listeners = new Set<() => void>();
const publish = (next: UpdateState) => {
  state = next;
  for (const listener of listeners) listener();
};
export const getUpdateState = () => state;
export function subscribeToUpdates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function updateIsBusy(status: UpdateState["status"]) {
  return status === "downloading" || status === "installing";
}
export function dismissUpdate() {
  publish({ ...state, dismissed: true });
}

export async function checkInstallerUpdate() {
  if (state.status === "checking" || updateIsBusy(state.status)) return;
  if (!backendAvailable()) {
    publish({ ...state, status: "disabled" });
    return;
  }
  publish({ ...state, status: "checking", error: null, dismissed: false });
  try {
    const info = await invoke<UpdateInfo>("check_installer_update");
    publish({
      ...state,
      info,
      status: info.mode === "disabled" ? "disabled" : info.version ? "available" : "current",
    });
  } catch (error) {
    publish({ ...state, status: "error", error: errorDetail(error) });
  }
}

export async function installInstallerUpdate() {
  if (
    !state.info?.version ||
    state.info.mode !== "automatic" ||
    !["available", "error"].includes(state.status)
  )
    return;
  publish({ ...state, status: "downloading", progress: null, error: null });
  try {
    const channel = createChannel<UpdateProgress>();
    channel.onmessage = (event) => {
      if (!updateIsBusy(state.status)) return;
      publish({
        ...state,
        status: event.stage,
        progress: event.total ? Math.min(100, (event.downloaded / event.total) * 100) : null,
      });
    };
    await invoke("install_installer_update", { onEvent: channel });
  } catch (error) {
    publish({ ...state, status: "error", error: errorDetail(error) });
  }
}

export async function openInstallerDownload() {
  try {
    await invoke("open_installer_download");
  } catch (error) {
    publish({ ...state, status: "error", error: errorDetail(error) });
  }
}
