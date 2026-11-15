import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React from "react";
import { useAutoRetry } from "../hooks/useAutoRetry";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { errorDetail } from "../lib/errors";
import {
  cancelInstallation,
  canRetry,
  failureMessage,
  formatElapsedTime,
  getInstallationState,
  installationLabel,
  saveDebugZip,
  subscribeToInstallation,
} from "../lib/installation";
import { Button } from "./ui/Button";
import { InstallationProgress } from "./ui/InstallationProgress";
import { InstallerScreen } from "./ui/InstallerScreen";

interface IInstallationScreenProps {
  onComplete: () => void;
  /** Starts the operation again once the iPod is back and checked. */
  onRetry: () => void;
  onBack: () => void;
}

const InstallationScreen: React.FC<IInstallationScreenProps> = ({
  onComplete,
  onRetry,
  onBack,
}) => {
  const state = React.useSyncExternalStore(subscribeToInstallation, getInstallationState);
  const [now, setNow] = React.useState(Date.now());
  const [savingDebug, setSavingDebug] = React.useState(false);
  // Holds the retry while the debug ZIP is saved, so it does not replace the
  // failed run it describes; the iPod is still watched meanwhile.
  const retry = useAutoRetry(
    state.failure !== null && !state.running && canRetry(state.failure),
    onRetry,
    savingDebug,
  );
  const [debugResult, setDebugResult] = React.useState<string | null>(null);
  const [debugError, setDebugError] = React.useState<string | null>(null);
  const saveDebug = async () => {
    setSavingDebug(true);
    setDebugResult(null);
    setDebugError(null);
    try {
      const path = await saveDebugZip();
      if (path) setDebugResult(`Debug ZIP saved: ${path}`);
    } catch (error) {
      setDebugError(`Could not save debug ZIP: ${errorDetail(error)}`);
    } finally {
      setSavingDebug(false);
    }
  };
  React.useEffect(() => {
    if (!state.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.running]);
  const elapsed = Math.max(0, (state.finishedAt ?? now) - state.startedAt);
  const snapshot = {
    id: `${state.event.stage}:${installationLabel(state.event)}`,
    label: installationLabel(state.event),
    complete: state.complete,
    percentage:
      state.event.total && state.event.completed !== null
        ? Math.min(100, Math.floor((state.event.completed * 100) / state.event.total))
        : null,
  };
  const failure = state.failure && failureMessage(state.failure);
  const { headingRef } = useHeadingFocus();
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (state.complete) onComplete();
  }, [state.complete, onComplete]);

  return (
    <InstallerScreen.Root aria-labelledby="installation-title">
      <InstallerScreen.Title id="installation-title" ref={headingRef} tabIndex={-1}>
        {state.failure ? "Installation stopped." : "Installing RepriseOS."}
      </InstallerScreen.Title>
      {!state.failure && (
        <div className="mx-auto mt-6 max-w-112">
          <InstallationProgress
            label={snapshot.label}
            value={snapshot.percentage}
            complete={snapshot.complete}
            stage={snapshot.id}
          />
          <div className="mt-3 flex min-h-6 items-center justify-center gap-3 text-[13px] text-body">
            <div aria-live="polite" aria-atomic="true">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={snapshot.id}
                  className="inline-block"
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.15 }}
                >
                  {snapshot.label}
                  {snapshot.complete ? "." : "…"}
                </motion.span>
              </AnimatePresence>
            </div>
            {snapshot.percentage !== null && (
              <span className="min-w-8 text-right font-medium tabular-nums text-ink">
                {snapshot.percentage}%
              </span>
            )}
          </div>
          <p className="mt-2 text-[12px] tabular-nums text-muted">
            Elapsed time{" "}
            <span className="mx-1" aria-hidden="true">
              ·
            </span>{" "}
            {formatElapsedTime(elapsed)}
          </p>
        </div>
      )}
      {state.running && (
        <p className="mt-4 text-[12px] leading-5 text-muted">
          {state.cancelling
            ? "Finishing the current operation…"
            : "Keep your iPod connected and your computer awake."}
        </p>
      )}
      {failure && (
        <div className="mx-auto mt-6 max-w-112 text-[13px] leading-6">
          <p role="alert" className="break-words text-body">
            {failure.cause}
          </p>
          {failure.next && (
            <div className="mt-5">
              <p className="text-[14px] font-medium text-ink">{failure.next}</p>
              {failure.retry && (
                <>
                  <p className="text-[12px] text-muted">
                    Hold Menu + Center for about 12 seconds, past the Apple logo, and release when
                    the screen turns black again.
                  </p>
                  {retry.error && (
                    <p role="alert" className="mt-4 text-[#aa3e36]">
                      {retry.error}
                    </p>
                  )}
                  {/* Mounted empty so screen readers announce the first status. */}
                  <p
                    role="status"
                    className="mt-4 inline-flex min-h-6 items-center gap-2 text-body"
                  >
                    {retry.status && (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-focus motion-safe:animate-pulse"
                        />
                        {retry.status}
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <InstallerScreen.Actions className="mt-6">
        {state.failure ? (
          <>
            <Button.Root disabled={savingDebug || retry.checking} onClick={onBack}>
              <Button.Label>Back to start</Button.Label>
            </Button.Root>
            <Button.Root disabled={savingDebug || retry.checking} onClick={saveDebug}>
              <Button.Label>{savingDebug ? "Saving…" : "Save debug ZIP"}</Button.Label>
            </Button.Root>
          </>
        ) : state.running && state.event.cancellable ? (
          <Button.Root disabled={state.cancelling} onClick={cancelInstallation}>
            <Button.Label>Cancel</Button.Label>
          </Button.Root>
        ) : null}
      </InstallerScreen.Actions>
      {debugResult && (
        <p role="status" className="mt-3 break-all text-[12px] text-muted">
          {debugResult}
        </p>
      )}
      {debugError && (
        <p role="alert" className="mt-3 text-[12px] text-[#aa3e36]">
          {debugError}
        </p>
      )}
    </InstallerScreen.Root>
  );
};

export { InstallationScreen };
