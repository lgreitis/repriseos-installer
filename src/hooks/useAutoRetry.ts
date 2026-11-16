import React from "react";
import {
  acceptUnknownHardware,
  type DeviceInfo,
  getCheckState,
  startDeviceChecks,
  subscribeToChecks,
} from "../lib/deviceChecks";
import { appendSessionLog } from "../lib/sessionLog";
import { useDfuDetection } from "./useDfuDetection";

/** How long the iPod has to stay in DFU before the retry starts, so a user
 * still holding the buttons does not reset it in the middle of the checks. */
const SETTLE_MS = 3000;

const key = (device: DeviceInfo) =>
  `${device.selector.bus}:${device.selector.address}:${device.port_path.join(".")}`;

/**
 * Waits for the iPod of a failed install to come back in DFU, checks it, and
 * calls `onReady` once it passes. The iPod counts as back only after it left
 * the bus or re-enumerated at another address: a hung iPod stays on the bus,
 * and one still idle in DFU has to be put back in DFU by the user first, or a
 * lasting failure would retry forever. A failed check waits the same way.
 * While `paused`, it keeps watching but does not start the checks.
 */
export function useAutoRetry(enabled: boolean, onReady: () => void, paused = false) {
  const checks = React.useSyncExternalStore(subscribeToChecks, getCheckState);
  const [phase, setPhase] = React.useState<"waiting" | "settling" | "checking">("waiting");
  const [error, setError] = React.useState<string | null>(null);
  // The iPod seen when waiting began, null once it left, undefined before
  // the first scan.
  const baseline = React.useRef<string | null | undefined>(undefined);
  const expected = React.useRef<{ serial?: string; override?: boolean } | null>(null);
  const jobId = React.useRef(0);
  const ready = React.useRef(onReady);
  ready.current = onReady;
  const active = enabled && phase !== "checking";
  const detection = useDfuDetection(active);
  const { device, scanned, failed } = detection;
  const found = device && key(device);

  React.useEffect(() => {
    if (!enabled) return;
    const previous = getCheckState();
    baseline.current = undefined;
    expected.current = {
      serial: previous.report?.identity?.serial,
      override: previous.report?.hardware_override,
    };
    setPhase("waiting");
    setError(null);
  }, [enabled]);

  // `device` is a new object on every poll; `found` names the same iPod.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  React.useEffect(() => {
    // A failed scan says nothing about whether the iPod left.
    if (!active || !scanned || failed) return;
    if (baseline.current === undefined) baseline.current = found;
    if (!found || !device) {
      baseline.current = null;
      setPhase("waiting");
      return;
    }
    if (found === baseline.current) return;
    setPhase("settling");
    if (paused) return;
    const timer = setTimeout(() => {
      baseline.current = found;
      const before = getCheckState().jobId;
      startDeviceChecks(device);
      if (getCheckState().jobId === before) {
        setPhase("waiting");
        return;
      }
      jobId.current = getCheckState().jobId;
      appendSessionLog("iPod back in DFU mode; checking it before retrying.");
      setError(null);
      setPhase("checking");
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, scanned, failed, found, paused]);

  React.useEffect(() => {
    if (paused || phase !== "checking" || checks.running || checks.jobId !== jobId.current) return;
    const report = checks.report;
    if (report?.issue?.kind === "unknown_hardware" && expected.current?.override) {
      // The user already accepted this hardware for the install that failed.
      acceptUnknownHardware();
      if (getCheckState().jobId !== checks.jobId) {
        jobId.current = getCheckState().jobId;
        return;
      }
    }
    const serial = report?.identity?.serial;
    const failure =
      checks.error ??
      (expected.current?.serial && serial !== expected.current.serial
        ? "This is a different iPod. Connect the one you were installing to."
        : null);
    if (failure) {
      appendSessionLog(`Retry waiting: ${failure}`);
      setError(failure);
      setPhase("waiting");
      return;
    }
    jobId.current = -1;
    setPhase("waiting");
    ready.current();
  }, [phase, checks, paused]);

  // Empty until the first scan, so the status region exists before its first
  // message and screen readers announce it.
  const status =
    phase === "checking"
      ? "Checking your iPod…"
      : phase === "settling"
        ? "iPod found. Release the buttons."
        : !scanned && !failed
          ? ""
          : detection.idle || device
            ? "Waiting for your iPod…"
            : detection.message;
  return { status, error, checking: phase === "checking" };
}
