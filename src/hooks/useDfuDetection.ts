import React from "react";
import { type DeviceInfo, discoverDevices } from "../lib/deviceChecks";
import { errorDetail } from "../lib/errors";
import { appendSessionLog } from "../lib/sessionLog";

export function useDfuDetection(enabled: boolean) {
  const [devices, setDevices] = React.useState<DeviceInfo[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  // Whether `devices` comes from a scan since polling was last enabled.
  const [scanned, setScanned] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const found = await discoverDevices();
        if (!active) return;
        setDevices(found);
        setError(null);
        setScanned(true);
      } catch (error) {
        if (!active) return;
        setDevices([]);
        setError(errorDetail(error));
      }
      if (active) timer = setTimeout(poll, 500);
    };
    void poll();
    // A later enable starts from no scan, not from what the last poll saw.
    return () => {
      active = false;
      clearTimeout(timer);
      setScanned(false);
      setDevices([]);
      setError(null);
    };
  }, [enabled]);

  const candidates = devices.filter((device) => device.dfu_candidate);
  const device = candidates.length === 1 && !error ? candidates[0] : null;
  const message =
    error ??
    (candidates.length > 1
      ? "More than one iPod detected. Leave one connected."
      : device
        ? "iPod detected in DFU mode. Release the buttons, then continue."
        : devices.length > 0
          ? "iPod connected. Follow the steps to enter DFU mode."
          : "Waiting for your iPod…");
  const lastMessage = React.useRef("");
  React.useEffect(() => {
    if (!enabled || lastMessage.current === message) return;
    lastMessage.current = message;
    appendSessionLog(`DFU discovery: ${message}`);
  }, [enabled, message]);

  // Nothing connected and nothing wrong: the plain waiting state.
  const idle = !error && devices.length === 0;
  return { device, message, scanned, failed: error !== null, idle };
}
