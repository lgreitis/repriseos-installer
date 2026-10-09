import React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { describeCheckFailure } from "../lib/checkFailure";
import {
  type Check,
  type CheckId,
  getCheckState,
  retryDeviceChecks,
  startDeviceChecks,
  subscribeToChecks,
} from "../lib/deviceChecks";
import { Button } from "./ui/Button";
import { CheckList, type CheckStatus } from "./ui/CheckList";
import { HelpDisclosure } from "./ui/HelpDisclosure";
import { InstallerScreen } from "./ui/InstallerScreen";

interface IDeviceChecksScreenProps {
  onContinue: () => void;
  onBack: () => void;
  onChangeFirmware: () => void;
}

const groups: { id: string; label: string; checks: CheckId[] }[] = [
  { id: "connection", label: "iPod connection", checks: ["usb", "access", "dfu"] },
  { id: "compatibility", label: "iPod compatibility", checks: ["rom", "model"] },
  { id: "firmware", label: "Apple firmware", checks: ["version"] },
];

const labels: Record<CheckId, string> = {
  usb: "USB connection",
  access: "USB access",
  dfu: "DFU state",
  rom: "BootROM",
  model: "Model and hardware",
  version: "Recorded firmware",
};

function groupStatus(checks: Check[]): CheckStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.every((check) => check.status === "passed")) return "passed";
  if (checks.some((check) => check.status === "skipped")) return "skipped";
  if (checks.some((check) => check.status === "running" || check.status === "passed"))
    return "checking";
  return "pending";
}

const DeviceChecksScreen: React.FC<IDeviceChecksScreenProps> = ({
  onContinue,
  onBack,
  onChangeFirmware,
}) => {
  const { checks, running, report, error, progress, device, reconnecting, replacement } =
    React.useSyncExternalStore(subscribeToChecks, getCheckState);
  const { headingRef } = useHeadingFocus();
  const complete =
    !running &&
    !reconnecting &&
    !replacement &&
    !error &&
    report?.compatible === true &&
    report.cleanup.state === "idle";
  const current = checks.find((check) => check.status === "running");
  const failure =
    !running && !reconnecting && !replacement ? describeCheckFailure(report, error) : null;
  const results: Record<string, string> = {
    connection: "Connected",
    compatibility: report?.identity?.model ?? "Supported",
    firmware: report?.identity?.recorded_firmware ?? "Supported",
  };

  return (
    <InstallerScreen.Root aria-labelledby="checks-title">
      <InstallerScreen.Title id="checks-title" ref={headingRef} tabIndex={-1}>
        {replacement
          ? "iPod detected."
          : complete
            ? "Checks complete."
            : error
              ? (failure?.title ?? "Couldn’t complete the checks.")
              : "Checking your iPod."}
      </InstallerScreen.Title>
      <CheckList.Root className="mt-9 max-w-124" aria-label="Device checks">
        {groups.map((group) => {
          const status = groupStatus(checks.filter((check) => group.checks.includes(check.id)));
          const result =
            status === "passed"
              ? results[group.id]
              : status === "failed"
                ? "Failed"
                : status === "skipped"
                  ? "Skipped"
                  : status === "checking"
                    ? "Checking…"
                    : "Waiting";
          return (
            <CheckList.Item key={group.id} status={status}>
              <CheckList.Label>{group.label}</CheckList.Label>
              <CheckList.Result>{result}</CheckList.Result>
            </CheckList.Item>
          );
        })}
      </CheckList.Root>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reconnecting
          ? "Looking for your iPod."
          : replacement
            ? "An iPod was detected. Check the connected iPod to continue."
            : complete
              ? "All checks passed. Continue is available."
              : error
                ? (failure?.message ?? "Checks stopped. Review the error and try again.")
                : current
                  ? `Checking ${labels[current.id]}.`
                  : "Finishing checks…"}
      </p>
      {replacement && (
        <p className="mx-auto mt-5 max-w-124 text-[13px] leading-6 text-body" role="status">
          An iPod is connected. Confirm it’s the one you want to check.
        </p>
      )}
      {failure && (
        <div className="mx-auto mt-5 max-w-124 text-[13px] leading-6 text-body" role="alert">
          <p className={failure.action === "retry" ? "break-words text-[#aa3e36]" : "break-words"}>
            {failure.message}
          </p>
        </div>
      )}
      <HelpDisclosure label="Check details">
        <dl className="space-y-3">
          {checks.map((check) => (
            <div key={check.id}>
              <dt className="font-bold text-ink">
                {labels[check.id]} · {check.status}
              </dt>
              <dd className="break-words">
                {check.detail || "Waiting"}
                {check.id === "rom" && check.status === "running" && progress && (
                  <span> · {Math.floor((progress.completed / progress.total) * 100)}%</span>
                )}
              </dd>
            </div>
          ))}
          {report && (
            <div>
              <dt className="font-bold text-ink">DFU cleanup</dt>
              <dd>
                {report.cleanup.state === "idle"
                  ? "Ready"
                  : (report.cleanup.detail ?? "Not attempted")}
              </dd>
            </div>
          )}
        </dl>
      </HelpDisclosure>
      <InstallerScreen.Actions className="mt-7 min-h-12">
        {failure?.action === "another-ipod" ? (
          <Button.Root onClick={onBack}>
            <Button.Label>Check another iPod</Button.Label>
          </Button.Root>
        ) : failure?.action === "firmware" ? (
          <Button.Root onClick={onChangeFirmware}>
            <Button.Label>Change firmware</Button.Label>
          </Button.Root>
        ) : error || replacement ? (
          <React.Fragment>
            <Button.Root disabled={reconnecting} onClick={onBack}>
              <Button.Label>DFU guide</Button.Label>
            </Button.Root>
            <Button.Root
              disabled={running || reconnecting || !device}
              onClick={() => {
                if (replacement) startDeviceChecks(replacement);
                else void retryDeviceChecks();
              }}
            >
              <Button.Label>
                {reconnecting
                  ? "Looking for iPod…"
                  : replacement
                    ? "Check reconnected iPod"
                    : "Try again"}
              </Button.Label>
            </Button.Root>
          </React.Fragment>
        ) : (
          <Button.Root
            className="min-w-40"
            disabled={!complete}
            onClick={() => {
              if (complete) onContinue();
            }}
          >
            <Button.Label>Continue</Button.Label>
          </Button.Root>
        )}
      </InstallerScreen.Actions>
    </InstallerScreen.Root>
  );
};

export { DeviceChecksScreen };
