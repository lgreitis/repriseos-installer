import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import React from "react";
import { useDfuDetection } from "../hooks/useDfuDetection";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import type { DeviceInfo } from "../lib/deviceChecks";
import { Button } from "./ui/Button";
import { InstallerScreen } from "./ui/InstallerScreen";
import { IpodIllustration } from "./ui/IpodIllustration";

interface IDfuScreenProps {
  onContinue: (device: DeviceInfo) => void;
}

const instructions = [
  <React.Fragment key="connect">
    Connect your iPod with a reliable <strong>30-pin USB cable.</strong>
  </React.Fragment>,
  <React.Fragment key="unlock">
    Make sure the <strong>Hold switch is unlocked</strong> (no orange showing).
  </React.Fragment>,
  <React.Fragment key="hold">
    Hold <strong>Menu + Center</strong> together for about <strong>12 seconds.</strong>
  </React.Fragment>,
  <React.Fragment key="release">
    Keep holding past the Apple logo. Release when the screen turns <strong>black again.</strong>
  </React.Fragment>,
];

const DfuScreen: React.FC<IDfuScreenProps> = ({ onContinue }) => {
  const reducedMotion = useReducedMotion();
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [continuing, setContinuing] = React.useState(false);
  const { device, message } = useDfuDetection(!continuing);
  const rootRef = React.useRef<HTMLElement>(null);
  const illustrationRef = React.useRef<HTMLDivElement>(null);
  const { headingRef, focusHeading } = useHeadingFocus(false);
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
    const illustrationHeight = illustrationRef.current?.offsetHeight ?? 396;
    const rootTop = rootRef.current?.getBoundingClientRect().top ?? 0;
    const introHeight = Math.min(
      window.innerHeight * 0.8,
      760,
      (window.innerWidth - 48) * (729 / 443),
    );

    y.set(window.innerHeight / 2 - rootTop - illustrationHeight / 2);
    scale.set(Math.max(1, introHeight / illustrationHeight));
    if (!imageLoaded) return;

    const transition = { delay: 0.75, duration: 0.85, ease: [0.22, 1, 0.36, 1] as const };
    const movement = animate(y, 0, { ...transition, onComplete: () => setReady(true) });
    const sizing = animate(scale, 1, transition);
    return () => {
      movement.stop();
      sizing.stop();
    };
  }, [imageLoaded, reducedMotion, scale, y]);

  return (
    <InstallerScreen.Root ref={rootRef} aria-labelledby="dfu-title">
      <motion.div
        ref={illustrationRef}
        className="relative mx-auto mb-7 flex h-[clamp(340px,44svh,420px)] w-fit justify-center"
        style={{ y, scale }}
        initial={{ opacity: 0 }}
        animate={{ opacity: imageLoaded ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.25 }}
      >
        <IpodIllustration onLoad={() => setImageLoaded(true)} />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.5 }}
        inert={!ready}
        aria-hidden={!ready}
        onAnimationComplete={() => {
          if (ready) focusHeading();
        }}
      >
        <InstallerScreen.Title id="dfu-title" ref={headingRef} tabIndex={-1}>
          Put your iPod in DFU mode.
        </InstallerScreen.Title>
        <ol className="mx-auto mt-6 max-w-140 space-y-3 text-left text-[14px] leading-6 text-body [&_strong]:font-bold [&_strong]:text-ink">
          {instructions.map((instruction, index) => (
            <li key={instruction.key} className="flex items-baseline gap-3.5">
              <span
                className="w-4 shrink-0 text-right text-[12px] tabular-nums text-muted"
                aria-hidden="true"
              >
                {index + 1}.
              </span>
              <span>{instruction}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[13px] text-body" role="status" aria-live="polite">
          {message}
        </p>
        <InstallerScreen.Actions className="mt-7">
          <Button.Root
            className="min-w-40"
            disabled={!device || continuing}
            onClick={() => {
              if (!device || continuing) return;
              setContinuing(true);
              onContinue(device);
            }}
          >
            <Button.Label>Continue</Button.Label>
          </Button.Root>
        </InstallerScreen.Actions>
      </motion.div>
    </InstallerScreen.Root>
  );
};

export { DfuScreen };
