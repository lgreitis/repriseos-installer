import React from "react";
import { type UpdateState, updateIsBusy } from "../lib/updates";
import { Button } from "./ui/Button";
import { InstallationProgress } from "./ui/InstallationProgress";

interface Props {
  state: UpdateState;
  onCheck: () => void;
  onInstall: () => void;
  onDownload: () => void;
  onLater: () => void;
}

export const InstallerUpdate: React.FC<Props> = ({
  state,
  onCheck,
  onInstall,
  onDownload,
  onLater,
}) => {
  const { status, info, error, progress, dismissed } = state;
  const [manualCheck, setManualCheck] = React.useState(false);
  const showCurrent = manualCheck && status === "current";
  React.useEffect(() => {
    if (!manualCheck || status === "checking") return;
    const timeout = window.setTimeout(() => setManualCheck(false), status === "current" ? 2500 : 0);
    return () => window.clearTimeout(timeout);
  }, [manualCheck, status]);
  const busy = updateIsBusy(status);
  const available = !!info?.version && !dismissed;
  const version = info ? `Installer ${info.current_version}` : "Installer";
  if (status === "disabled") return null;
  if (!busy && !available && status !== "error") {
    return (
      <div className="mx-auto mt-7 max-w-100 text-center text-[12px] text-muted" aria-live="polite">
        <p>{version}</p>
        <button
          type="button"
          disabled={status === "checking" || showCurrent}
          onClick={() => {
            setManualCheck(true);
            onCheck();
          }}
          className="mt-1 cursor-pointer rounded-sm underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:no-underline"
        >
          {status === "checking"
            ? "Checking for updates…"
            : showCurrent
              ? "Up to date"
              : "Check for updates"}
        </button>
      </div>
    );
  }
  return (
    <section
      className="installer-well mx-auto mt-7 max-w-100 rounded-lg p-5 text-left"
      aria-label="Installer update"
    >
      <div role="status" aria-live="polite">
        <p className="text-[14px] font-medium text-ink">
          {status === "downloading"
            ? "Downloading installer update…"
            : status === "installing"
              ? "Installing update…"
              : status === "error"
                ? "Installer update failed"
                : "Installer update available"}
        </p>
        <p className="mt-1 text-[13px] leading-6 text-body">
          {busy
            ? "The installer will restart when the update is ready."
            : available
              ? `Version ${info?.version} is available.`
              : "Please try again or download the latest installer."}
        </p>
      </div>
      {busy && (
        <div className="mt-4">
          <InstallationProgress
            label="Installer update download"
            value={progress}
            complete={false}
            stage={status}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 break-words text-[12px] leading-5 text-[#aa3e36]">
          {error}
        </p>
      )}
      {!busy && (
        <div className="mt-4 flex flex-wrap gap-2">
          {available && info?.mode === "automatic" ? (
            <Button.Root size="compact" onClick={onInstall}>
              <Button.Label>Update and restart</Button.Label>
            </Button.Root>
          ) : (
            <Button.Root size="compact" onClick={status === "error" ? onCheck : onDownload}>
              <Button.Label>{status === "error" ? "Try again" : "Download update"}</Button.Label>
            </Button.Root>
          )}
          {status === "error" ? (
            <Button.Root size="compact" onClick={onDownload}>
              <Button.Label>Download manually</Button.Label>
            </Button.Root>
          ) : (
            <Button.Root size="compact" onClick={onLater}>
              <Button.Label>Later</Button.Label>
            </Button.Root>
          )}
        </div>
      )}
    </section>
  );
};
