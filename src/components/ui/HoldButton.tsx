import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import React from "react";
import { Button } from "./Button";

interface IHoldButtonProps {
  onComplete: () => void;
  duration?: number;
  describedBy?: string;
}

const HoldButton: React.FC<IHoldButtonProps> = ({ onComplete, duration = 3, describedBy }) => {
  const progress = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const animationRef = React.useRef<ReturnType<typeof animate> | null>(null);
  const inputRef = React.useRef<"pointer" | "keyboard" | null>(null);
  const completedRef = React.useRef(false);
  const [holding, setHolding] = React.useState(false);
  const labelId = React.useId();

  const cancel = React.useCallback(() => {
    if (completedRef.current || !inputRef.current) return;
    animationRef.current?.stop();
    inputRef.current = null;
    setHolding(false);
    animationRef.current = animate(progress, 0, {
      duration: reducedMotion ? 0.1 : 0.5,
      ease: [0.22, 1, 0.36, 1],
    });
  }, [progress, reducedMotion]);

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      animationRef.current?.stop();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancel]);

  const start = (input: "pointer" | "keyboard") => {
    if (inputRef.current || completedRef.current) return;
    animationRef.current?.stop();
    inputRef.current = input;
    setHolding(true);
    animationRef.current = animate(progress, 1, {
      duration,
      ease: "linear",
      onComplete: () => {
        if (!inputRef.current || document.hidden || !document.hasFocus()) {
          cancel();
          return;
        }
        completedRef.current = true;
        inputRef.current = null;
        onComplete();
      },
    });
  };

  return (
    <Button.Root
      intent="danger"
      className="w-52"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      data-holding={holding || undefined}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        start("pointer");
      }}
      onPointerMove={(event) => {
        if (inputRef.current !== "pointer") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          cancel();
      }}
      onPointerUp={() => {
        if (inputRef.current === "pointer") cancel();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (inputRef.current === "pointer") cancel();
      }}
      onBlur={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) start("keyboard");
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (inputRef.current === "keyboard") cancel();
      }}
    >
      <motion.span
        className="pointer-events-none absolute inset-0 z-10 origin-left bg-[#601815]/35"
        style={{ scaleX: progress }}
        aria-hidden="true"
      />
      <Button.Label id={labelId}>{holding ? "Keep holding…" : "I understand"}</Button.Label>
    </Button.Root>
  );
};

export { HoldButton };
