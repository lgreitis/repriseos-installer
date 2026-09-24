import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { errorDetail } from "../lib/deviceChecks";
import { chooseFirmware, type FirmwareInfo } from "../lib/installation";
import { chooseLocalPackage, type PackageInfo, preparePackage } from "../lib/package";
import { appendSessionLog } from "../lib/sessionLog";
import { Button } from "./ui/Button";
import { CheckStatusIndicator } from "./ui/CheckList";
import { InformationSymbol } from "./ui/InformationSymbol";
import { InstallerScreen } from "./ui/InstallerScreen";
import { ScreenReveal } from "./ui/ScreenReveal";

interface IFirmwareScreenProps {
  file: FirmwareInfo | null;
  onSelect: (file: FirmwareInfo | null) => void;
  localPackage: PackageInfo | null;
  onSelectPackage: (value: PackageInfo | null) => void;
  onContinue: (packageDigest: string) => void;
  onBack: () => void;
}

const FirmwareScreen: React.FC<IFirmwareScreenProps> = ({
  file,
  onSelect,
  localPackage,
  onSelectPackage,
  onContinue,
  onBack,
}) => {
  const [filename, setFilename] = React.useState(file?.filename ?? "");
  const { headingRef } = useHeadingFocus();
  const [error, setError] = React.useState("");
  const [packageError, setPackageError] = React.useState("");
  const [loading, setLoading] = React.useState<"choose" | "prepare" | null>(null);
  const [firmwareAction, setFirmwareAction] = React.useState<"choose" | "validate" | null>(null);
  const choosingFirmware = firmwareAction !== null;
  const validatingFirmware = firmwareAction === "validate";
  const reducedMotion = useReducedMotion();

  const choosePackage = async () => {
    setLoading("choose");
    setPackageError("");
    try {
      const selected = await chooseLocalPackage();
      if (selected) {
        onSelectPackage(selected);
        appendSessionLog(`Local package loaded: ${selected.filename} (${selected.version}).`);
      }
    } catch (error) {
      const detail = errorDetail(error);
      setPackageError(detail);
      appendSessionLog(`Package loading failed: ${detail}`);
    } finally {
      setLoading(null);
    }
  };

  const continueSetup = async () => {
    if (!file || choosingFirmware || error || loading) return;
    setLoading("prepare");
    setPackageError("");
    try {
      const selected = await preparePackage(localPackage);
      appendSessionLog(`Package ready: ${selected.version} (${selected.digest}).`);
      onContinue(selected.digest);
    } catch (error) {
      const detail = errorDetail(error);
      setPackageError(detail);
      appendSessionLog(`Package preparation failed: ${detail}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <InstallerScreen.Root aria-labelledby="firmware-title">
      <ScreenReveal>
        <div className="mx-auto mb-8 size-20">
          <InformationSymbol />
        </div>
        <InstallerScreen.Title id="firmware-title" ref={headingRef} tabIndex={-1}>
          Choose your firmware file.
        </InstallerScreen.Title>
      </ScreenReveal>
      <ScreenReveal delay={0.08}>
        <InstallerScreen.Description>
          Select a compatible IPSW firmware file.
        </InstallerScreen.Description>
        <div className="installer-well mx-auto mt-7 flex max-w-125 flex-wrap items-center justify-between gap-4 rounded-lg p-4 text-left">
          <div className="min-w-0 flex-1 text-[13px] text-body" role="status">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={filename || "empty"}
                className="break-all"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
              >
                {filename || "No firmware selected"}
              </motion.p>
            </AnimatePresence>
          </div>
          <Button.Root
            size="compact"
            disabled={!!loading || choosingFirmware}
            onClick={async () => {
              setFirmwareAction("choose");
              try {
                const selected = await chooseFirmware((name) => {
                  setFilename(name);
                  onSelect(null);
                  setError("");
                  setFirmwareAction("validate");
                  appendSessionLog(`Validating firmware: ${name}.`);
                });
                if (selected) onSelect(selected);
              } catch (error) {
                const detail = errorDetail(error);
                setError(detail);
                appendSessionLog(`Firmware validation failed: ${detail}`);
              } finally {
                setFirmwareAction(null);
              }
            }}
          >
            <Button.Label>{filename ? "Change…" : "Choose file…"}</Button.Label>
          </Button.Root>
        </div>
        <div className="mx-auto max-w-125 text-left" role="status" aria-atomic="true">
          {(validatingFirmware || error || file) && (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-body">
              <CheckStatusIndicator
                status={validatingFirmware ? "checking" : error ? "failed" : "passed"}
              />
              {validatingFirmware
                ? "Checking firmware compatibility…"
                : error
                  ? "Firmware validation failed."
                  : `Compatible firmware · Apple ${file?.version}`}
            </p>
          )}
          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.2 }}
                className="overflow-hidden text-[12px] leading-6 text-[#aa3e36]"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <section
          className="installer-well mx-auto mt-5 max-w-125 rounded-lg p-4 text-left"
          aria-labelledby="package-title"
          aria-busy={!!loading}
        >
          <h2 id="package-title" className="text-[14px] font-medium text-ink">
            RepriseOS package
          </h2>
          <div className="mt-2 text-[13px] text-body" role="status">
            {loading ? (
              <p>
                {loading === "choose"
                  ? "Loading local package…"
                  : localPackage
                    ? "Preparing package…"
                    : "Downloading and verifying package…"}
              </p>
            ) : localPackage ? (
              <React.Fragment>
                <p>Version {localPackage.version}</p>
                <p className="mt-1 break-all">{localPackage.filename}</p>
              </React.Fragment>
            ) : (
              <p>The release will download automatically when you continue.</p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-4">
            <button
              type="button"
              className="cursor-pointer rounded-sm py-1 text-[12px] text-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-50"
              disabled={!!loading || choosingFirmware}
              onClick={choosePackage}
            >
              {localPackage ? "Change package…" : "Alternatively, choose a local package…"}
            </button>
            {localPackage && (
              <button
                type="button"
                className="cursor-pointer rounded-sm py-1 text-[12px] text-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-50"
                disabled={!!loading || choosingFirmware}
                onClick={() => {
                  onSelectPackage(null);
                  setPackageError("");
                  appendSessionLog("Automatic package download selected.");
                }}
              >
                Use download
              </button>
            )}
          </div>
          <div role="alert" className="mt-2 text-[12px] leading-6 text-[#aa3e36] empty:mt-0">
            {packageError}
          </div>
        </section>
      </ScreenReveal>
      <ScreenReveal delay={0.16}>
        <InstallerScreen.Actions>
          <Button.Root disabled={!!loading || choosingFirmware} onClick={onBack}>
            <Button.Label>Back</Button.Label>
          </Button.Root>
          <Button.Root
            disabled={!file || !!error || !!loading || choosingFirmware}
            onClick={continueSetup}
          >
            <Button.Label>Continue</Button.Label>
          </Button.Root>
        </InstallerScreen.Actions>
      </ScreenReveal>
    </InstallerScreen.Root>
  );
};

export { FirmwareScreen };
