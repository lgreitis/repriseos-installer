import { Channel, isTauri, invoke as nativeInvoke } from "@tauri-apps/api/core";

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
