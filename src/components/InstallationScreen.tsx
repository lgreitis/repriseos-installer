import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import {
  cancelInstallation,
  formatElapsedTime,
  getInstallationState,
  installationLabel,
  subscribeToInstallation,
} from "../lib/installation";
import { Button } from "./ui/Button";
import { InstallationProgress } from "./ui/InstallationProgress";
import { InstallerScreen } from "./ui/InstallerScreen";

interface IInstallationScreenProps {
  onComplete: () => void;
  onRecover: () => void;
}

const InstallationScreen: React.FC<IInstallationScreenProps> = ({ onComplete, onRecover }) => {
  const state = React.useSyncExternalStore(subscribeToInstallation, getInstallationState);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!state.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.running]);
  const elapsed = Math.max(0, (state.finishedAt ?? now) - state.startedAt);
  const snapshot = {
    id: `${state.event.stage}:${installationLabel(state.event)}`,
    label: state.error ? "Installation stopped" : installationLabel(state.event),
    complete: state.complete,
    percentage:
      state.event.total && state.event.completed !== null
        ? Math.min(100, Math.floor((state.event.completed * 100) / state.event.total))
        : null,
  };
  const { headingRef } = useHeadingFocus();
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (state.complete) onComplete();
  }, [state.complete, onComplete]);

  return (
    <InstallerScreen.Root aria-labelledby="installation-title">
      <InstallerScreen.Title id="installation-title" ref={headingRef} tabIndex={-1}>
        {state.error ? "Installation stopped." : "Installing RepriseOS."}
      </InstallerScreen.Title>
      <div className="mx-auto mt-10 max-w-112">
        <InstallationProgress
          label={snapshot.label}
          value={snapshot.percentage}
          complete={snapshot.complete}
          stage={snapshot.id}
        />
        <div className="mt-5 flex min-h-6 items-center justify-center gap-3 text-[13px] text-body">
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
      <p className="mt-8 min-h-10 text-[12px] leading-5 text-muted">
        {state.running &&
          (state.cancelling
            ? "Finishing the current operation…"
            : "Keep your iPod connected and your computer awake.")}
      </p>
      {state.error && (
        <p role="alert" className="mt-4 break-words text-[13px] leading-6 text-[#aa3e36]">
          {state.error}
        </p>
      )}
      <InstallerScreen.Actions>
        {state.error ? (
          <Button.Root onClick={onRecover}>
            <Button.Label>DFU guide</Button.Label>
          </Button.Root>
        ) : state.running && state.event.cancellable ? (
          <Button.Root disabled={state.cancelling} onClick={cancelInstallation}>
            <Button.Label>Cancel</Button.Label>
          </Button.Root>
        ) : null}
      </InstallerScreen.Actions>
    </InstallerScreen.Root>
  );
};

export { InstallationScreen };
