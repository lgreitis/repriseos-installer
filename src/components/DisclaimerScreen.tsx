import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import React from "react";
import { Button } from "./ui/Button";
import { HoldButton } from "./ui/HoldButton";
import { InstallerScreen } from "./ui/InstallerScreen";
import { WarningSymbol } from "./ui/WarningSymbol";

interface IDisclaimerScreenProps {
  onContinue: () => void;
  onQuit: () => void;
}

const pingDelays = [0, 0.5, 1];
const pingDuration = 0.9;

const DisclaimerScreen: React.FC<IDisclaimerScreenProps> = ({ onContinue, onQuit }) => {
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = React.useState(false);
  const rootRef = React.useRef<HTMLElement>(null);
  const symbolRef = React.useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);

  React.useLayoutEffect(() => {
    if (reducedMotion) {
      y.set(0);
      scale.set(1);
      setReady(true);
      return;
    }
    setReady(false);
    const height = rootRef.current?.offsetHeight ?? 540;
    const iconHeight = symbolRef.current?.offsetHeight ?? 112;
    y.set((height - iconHeight) / 2);
    scale.set(1.45);
    const transition = {
      delay: Math.max(...pingDelays) + pingDuration,
      duration: 0.68,
      ease: [0.22, 1, 0.36, 1] as const,
    };
    const movement = animate(y, 0, { ...transition, onComplete: () => setReady(true) });
    const sizing = animate(scale, 1, transition);
    return () => {
      movement.stop();
      sizing.stop();
    };
  }, [reducedMotion, scale, y]);

  return (
    <InstallerScreen.Root ref={rootRef} aria-labelledby="disclaimer-title">
      <motion.div
        ref={symbolRef}
        className="relative mx-auto mb-9 h-28 w-30"
        style={{ y, scale }}
        aria-hidden="true"
      >
        {!reducedMotion &&
          pingDelays.map((delay) => (
            <motion.span
              key={delay}
              className="warning-pulse pointer-events-none absolute top-[calc(50%+8px)] left-1/2 -mt-20 -ml-20 size-40 rounded-full"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 0.22, 0.22, 0], scale: [0, 2] }}
              transition={{
                scale: {
                  delay,
                  duration: pingDuration,
                  ease: [0.2, 0, 0.4, 1],
                },
                opacity: {
                  delay,
                  duration: pingDuration,
                  times: [0, 0.08, 0.35, 1],
                  ease: ["easeOut", "linear", "easeInOut"],
                },
              }}
            />
          ))}
        <WarningSymbol />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.5 }}
        inert={!ready}
        aria-hidden={!ready}
      >
        <InstallerScreen.Title id="disclaimer-title">Before you install.</InstallerScreen.Title>
        <InstallerScreen.Description>
          You’re installing unfinished software.{" "}
          <strong className="font-bold text-ink">You are a beta tester.</strong>
          <br className="hidden sm:block" /> Your iPod could lose data or stop working permanently.
        </InstallerScreen.Description>
        <div
          className="mx-auto my-6 h-px w-14 bg-black/15 shadow-[0_1px_0_#ffffff]"
          aria-hidden="true"
        />
        <p className="mx-auto max-w-124 text-[13px] leading-[1.85] text-body">
          Proceed at your own risk. The developers accept no responsibility for damage, data loss,
          or any other consequences of using this software.
        </p>
        <p className="mt-4 text-[13px] font-bold text-ink">Back up your iPod before continuing.</p>
        <InstallerScreen.Actions>
          <Button.Root onClick={onQuit}>
            <Button.Label>Back</Button.Label>
          </Button.Root>
          <HoldButton onComplete={onContinue} duration={3} describedBy="hold-instructions" />
        </InstallerScreen.Actions>
        <p id="hold-instructions" className="mt-8 text-[12px] leading-5 text-muted">
          Hold “I understand” for 3 seconds to continue.
          <span className="sr-only">
            {" "}
            Release to cancel. With the button focused, hold Space or Enter.
          </span>
        </p>
      </motion.div>
    </InstallerScreen.Root>
  );
};

export { DisclaimerScreen };
