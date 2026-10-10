import React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { backendAvailable, invoke } from "../lib/backend";
import { errorDetail } from "../lib/errors";
import { appendSessionLog } from "../lib/sessionLog";
import { Button } from "./ui/Button";
import { InstallerScreen } from "./ui/InstallerScreen";

interface Props {
  onContinue: () => void;
  onBack: () => void;
}

export function UsbPermissionsScreen({ onContinue, onBack }: Props) {
  const { headingRef } = useHeadingFocus();
  const [status, setStatus] = React.useState<"checking" | "required" | "enabling" | "ready">(
    "checking",
  );
  const [error, setError] = React.useState<string | null>(null);
  const continueRef = React.useRef(onContinue);
  continueRef.current = onContinue;

  React.useEffect(() => {
    let active = true;
    const check = backendAvailable()
      ? invoke<boolean>("usb_permissions_ready")
      : Promise.resolve(true);
    void check
      .then((installed) => {
        if (!active) return;
        setStatus(installed ? "ready" : "required");
        if (installed) continueRef.current();
      })
      .catch((reason: unknown) => {
        if (active) {
          const detail = errorDetail(reason);
          setError(detail);
          setStatus("required");
          appendSessionLog(`USB access check failed: ${detail}`);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const pending = status === "checking" || status === "enabling";
  const continueSetup = async () => {
    if (status === "ready") {
      onContinue();
      return;
    }
    setStatus("enabling");
    setError(null);
    try {
      await invoke("enable_usb_access");
      setStatus("ready");
      appendSessionLog("Linux USB helper access enabled.");
    } catch (reason) {
      const detail = errorDetail(reason);
      setError(detail);
      setStatus("required");
      appendSessionLog(`USB access setup failed: ${detail}`);
    }
  };

  return (
    <InstallerScreen.Root aria-labelledby="usb-permissions-title">
      <InstallerScreen.Title id="usb-permissions-title" ref={headingRef} tabIndex={-1}>
        Enable iPod access.
      </InstallerScreen.Title>
      <p className="mx-auto mt-6 max-w-120 text-[14px] leading-6 text-body">
        Linux needs a one-time setup to let this installer communicate with your iPod. Your desktop
        will ask for administrator authentication.
      </p>
      <p className="mt-4 text-[13px] text-body" role="status">
        {status === "checking"
          ? "Checking USB access setup…"
          : status === "enabling"
            ? "Waiting for administrator authentication…"
            : status === "ready"
              ? "iPod access is enabled."
              : "The installer will continue running as your normal user."}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-[13px] text-[#aa3e36]">
          {error}
        </p>
      )}
      <InstallerScreen.Actions className="mt-7">
        <Button.Root disabled={pending} onClick={onBack}>
          <Button.Label>Back</Button.Label>
        </Button.Root>
        <Button.Root disabled={pending} onClick={continueSetup}>
          <Button.Label>{status === "ready" ? "Continue" : "Enable iPod access"}</Button.Label>
        </Button.Root>
      </InstallerScreen.Actions>
    </InstallerScreen.Root>
  );
}
