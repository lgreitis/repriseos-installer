import React from "react";
import { type DeviceInfo, discoverDevices, errorDetail } from "../lib/deviceChecks";
import { appendSessionLog } from "../lib/sessionLog";

export function useDfuDetection(enabled: boolean) {
  const [devices, setDevices] = React.useState<DeviceInfo[]>([]);
  const [error, setError] = React.useState<string | null>(null);

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
      } catch (error) {
        if (!active) return;
        setDevices([]);
        setError(errorDetail(error));
      }
      if (active) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
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

  return { device, message };
}
