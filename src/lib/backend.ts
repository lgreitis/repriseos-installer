import { Channel, isTauri, invoke as nativeInvoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface EventChannel<T> {
  onmessage: (message: T) => void;
}

export interface Backend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  createChannel<T>(): EventChannel<T>;
}

let developmentBackend: Backend | null = null;

export function installDevelopmentBackend(backend: Backend) {
  if (!import.meta.env?.DEV) throw new Error("Mock backend requires a development build.");
  if (developmentBackend) throw new Error("Reload before changing the mock backend.");
  developmentBackend = backend;
}

export function backendAvailable() {
  return developmentBackend !== null || isTauri();
}

export function createChannel<T>(): EventChannel<T> {
  return developmentBackend ? developmentBackend.createChannel<T>() : new Channel<T>();
}

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  // A simulated command must never fall back to native IPC.
  return developmentBackend
    ? developmentBackend.invoke<T>(command, args)
    : nativeInvoke<T>(command, args);
}

export function openExternalUrl(url: string): Promise<void> {
  return developmentBackend
    ? developmentBackend.invoke("plugin:opener|open_url", { url })
    : openUrl(url);
}

export function savePreviewDebugZip(sessionLog: string): Promise<string | null> {
  if (!import.meta.env?.DEV || !isTauri()) {
    return Promise.reject(
      new Error("Open this scenario in the desktop dev app to use the native Save dialog."),
    );
  }
  // This explicit preview command exports synthetic data and cannot access USB.
  return nativeInvoke("save_debug_zip", { sessionLog, preview: true });
}
