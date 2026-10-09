import type { CheckReport } from "./deviceChecks.ts";

export interface CheckFailure {
  title: string;
  message: string;
  action: "another-ipod" | "firmware" | "retry";
}

export function describeCheckFailure(
  report: CheckReport | null,
  error: string | null,
): CheckFailure | null {
  if (!error) return null;
  const issue = report?.cleanup.state === "idle" ? report.issue : null;
  switch (issue?.kind) {
    case "unsupported_model":
      return {
        title: "This iPod model isn’t supported.",
        message: `RepriseOS doesn’t currently support your iPod (${issue.model}).`,
        action: "another-ipod",
      };
    case "package_mismatch":
      return {
        title: "Firmware package doesn’t match.",
        message: `Choose a compatible Classic package for your ${issue.model} iPod.`,
        action: "firmware",
      };
    default:
      return { title: "Couldn’t complete the checks.", message: error, action: "retry" };
  }
}
