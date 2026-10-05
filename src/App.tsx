import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React from "react";
import { DeviceChecksScreen } from "./components/DeviceChecksScreen";
import { DfuScreen } from "./components/DfuScreen";
import { DisclaimerScreen } from "./components/DisclaimerScreen";
import { FirmwareScreen } from "./components/FirmwareScreen";
import { InstallationScreen } from "./components/InstallationScreen";
import { InstallerUpdates } from "./components/InstallerUpdates";
import { MainScreen } from "./components/MainScreen";
import { SuccessScreen } from "./components/SuccessScreen";
import { DebugLog } from "./components/ui/DebugLog";
import { startDeviceChecks } from "./lib/deviceChecks";
import { type FirmwareInfo, startInstallation } from "./lib/installation";
import type { PackageInfo } from "./lib/package";
import { appendSessionLog, getSessionLog, subscribeToSessionLog } from "./lib/sessionLog";
import { getUpdateState, subscribeToUpdates, updateIsBusy } from "./lib/updates";
import "./App.css";

type Screen = "main" | "disclaimer" | "firmware" | "dfu" | "checks" | "installation" | "success";

const App: React.FC = () => {
  const updater = React.useSyncExternalStore(subscribeToUpdates, getUpdateState);
  const [screen, setScreen] = React.useState<Screen>("main");
  const [firmware, setFirmware] = React.useState<FirmwareInfo | null>(null);
  const [localPackage, setLocalPackage] = React.useState<PackageInfo | null>(null);
  const [packageDigest, setPackageDigest] = React.useState("");
  const logs = React.useSyncExternalStore(subscribeToSessionLog, getSessionLog);
  const reducedMotion = useReducedMotion();
  const scrollRef = React.useRef<HTMLElement>(null);

  const beginInstall = () => {
    if (!firmware || !packageDigest) return;
    startInstallation(firmware, packageDigest);
    setScreen("installation");
  };

  return (
    <main
      ref={scrollRef}
      className="app-surface h-full overflow-x-hidden overflow-y-auto overscroll-none"
    >
      <div
        className={`flex min-h-full flex-col items-center px-6 sm:px-12 ${screen === "dfu" ? "py-8" : "py-14"}`}
      >
        <AnimatePresence mode="wait" onExitComplete={() => scrollRef.current?.scrollTo({ top: 0 })}>
          <motion.div
            key={screen}
            className="my-auto w-full max-w-160 shrink-0"
            initial={{ opacity: 0, y: reducedMotion || screen === "dfu" ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
            transition={{ duration: 0.25 }}
          >
            {screen === "main" ? (
              <MainScreen
                updates={<InstallerUpdates />}
                installDisabled={updateIsBusy(updater.status)}
                onInstall={() => {
                  appendSessionLog("New setup started.");
                  setFirmware(null);
                  setLocalPackage(null);
                  setPackageDigest("");
                  setScreen("disclaimer");
                }}
              />
            ) : screen === "disclaimer" ? (
              <DisclaimerScreen
                onContinue={() => {
                  appendSessionLog("Installation disclaimer acknowledged.");
                  setScreen("firmware");
                }}
                onQuit={() => setScreen("main")}
              />
            ) : screen === "firmware" ? (
              <FirmwareScreen
                file={firmware}
                localPackage={localPackage}
                onSelectPackage={setLocalPackage}
                onSelect={(file) => {
                  setFirmware(file);
                  if (file) {
                    appendSessionLog(`Firmware validated: ${file.filename} (${file.version}).`);
                  }
                }}
                onContinue={(digest) => {
                  setPackageDigest(digest);
                  appendSessionLog("Waiting for DFU connection.");
                  setScreen("dfu");
                }}
                onBack={() => setScreen("disclaimer")}
              />
            ) : screen === "dfu" ? (
              <DfuScreen
                onContinue={(device) => {
                  startDeviceChecks(device);
                  setScreen("checks");
                }}
              />
            ) : screen === "checks" ? (
              <DeviceChecksScreen
                onContinue={beginInstall}
                onBack={() => setScreen("dfu")}
                onChangeFirmware={() => {
                  setPackageDigest("");
                  setScreen("firmware");
                }}
              />
            ) : screen === "installation" ? (
              <InstallationScreen
                onComplete={() => setScreen("success")}
                onRecover={() => setScreen("dfu")}
              />
            ) : (
              <SuccessScreen onDone={() => setScreen("main")} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <DebugLog entries={logs} />
    </main>
  );
};

export default App;
