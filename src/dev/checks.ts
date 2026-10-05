import type { EventChannel } from "../lib/backend.ts";
import { type Check, type CheckReport, checkIds } from "../lib/deviceChecks.ts";
import type { Scenario } from "./scenarios.ts";

export type Wait = () => Promise<void>;

export async function simulateChecks(
  scenario: Scenario,
  channel: EventChannel<{ event: "check" } & Check>,
  wait: Wait,
): Promise<CheckReport> {
  const failure = scenario.checkFailure;
  const checks: Check[] = [];
  for (const id of checkIds) {
    channel.onmessage({ event: "check", id, status: "running", detail: "Checking" });
    await wait();
    const check: Check = {
      id,
      status: checks.some((check) => check.status === "failed") ? "skipped" : "passed",
      detail: id === "version" ? "SysCfg records 2.0.4" : "Passed",
    };
    if (failure?.id === id) {
      check.status = "failed";
      check.detail = failure.detail;
    }
    if (check.status === "skipped") check.detail = "A preceding check failed";
    checks.push(check);
    channel.onmessage({ event: "check", ...check });
  }
  return {
    checks,
    issue: scenario.issue ?? null,
    compatible: !failure,
    cleanup: scenario.cleanupFailure
      ? { state: "failed", detail: scenario.cleanupFailure }
      : { state: "idle" },
    identity:
      checks.find((check) => check.id === "model")?.status === "skipped"
        ? null
        : {
            model: failure?.model ?? "MC293",
            serial: "MOCK-IPOD",
            recorded_firmware: failure?.version ?? "2.0.4",
          },
  };
}
