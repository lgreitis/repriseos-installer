import App from "../App";
import { installDevelopmentBackend } from "../lib/backend.ts";
import { startDeviceChecks } from "../lib/deviceChecks.ts";
import { startInstallation } from "../lib/installation.ts";
import { checkInstallerUpdate, installInstallerUpdate } from "../lib/updates.ts";
import { mockDevice, mockFirmware, mockPackage } from "./fixtures.ts";
import { createMockBackend } from "./mockBackend.ts";
import { findScenario, scenarios } from "./scenarios.ts";

const scenario = findScenario(new URLSearchParams(location.search).get("scenario"));

export function initializePreview() {
  installDevelopmentBackend(createMockBackend(scenario));
  if (scenario.screen === "checks") startDeviceChecks(mockDevice);
  if (scenario.screen === "installation") startInstallation(mockFirmware, mockPackage.digest);
  if (scenario.startUpdate) void checkInstallerUpdate().then(installInstallerUpdate);
}

function selectScenario(id: string) {
  const url = new URL(location.href);
  url.searchParams.set("scenario", id);
  location.assign(url);
}

export function DevPanel() {
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <aside
        className="border-b border-black/20 bg-white p-3 pt-14 text-xs text-ink"
        aria-label="Development scenarios"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="dev-scenario" className="font-bold">
            Dev scenarios
          </label>
          <select
            id="dev-scenario"
            value={scenario.id}
            onChange={(event) => selectScenario(event.target.value)}
            className="max-w-full rounded border border-black/20 bg-white p-2"
          >
            {[...new Set(scenarios.map((item) => item.group))].map((group) => (
              <optgroup key={group} label={group}>
                {scenarios
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-black/20 px-3 py-2"
            onClick={() => location.reload()}
          >
            Replay
          </button>
          <a href={location.pathname} className="ml-auto underline">
            Exit preview
          </a>
        </div>
        {scenario.hint && <p className="mt-2 text-body">{scenario.hint}</p>}
      </aside>
      <App
        initial={{
          screen: scenario.screen,
          firmware: scenario.firmwareError ? null : mockFirmware,
          packageDigest: mockPackage.digest,
        }}
      />
    </div>
  );
}
