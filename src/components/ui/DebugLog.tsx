import { Button as BaseButton } from "@base-ui/react/button";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";

interface IDebugLogProps {
  entries: string[];
}

const DebugLog: React.FC<IDebugLogProps> = ({ entries }) => {
  const [open, setOpen] = React.useState(false);
  const reducedMotion = useReducedMotion();
  const [copyStatus, setCopyStatus] = React.useState("Copy log");
  const scrollRef = React.useRef<HTMLPreElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const followLogRef = React.useRef(true);
  const panelId = React.useId();
  const logText = entries.join("\n");
  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    scrollRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  React.useEffect(() => {
    if (open && logText && followLogRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, logText]);

  React.useEffect(() => {
    if (copyStatus === "Copy log") return;
    const timeout = window.setTimeout(() => setCopyStatus("Copy log"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(logText);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Select log to copy");
    }
  };

  return (
    <React.Fragment>
      <BaseButton
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((previous) => !previous)}
        className="glass-button glass-button-neutral fixed top-3 left-3 z-50 rounded-md border border-[#bcbab5] px-3 py-2 text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
      >
        Installation log{" "}
        <span aria-hidden="true" className="ml-2">
          {open ? "▴" : "▾"}
        </span>
      </BaseButton>
      <motion.section
        id={panelId}
        aria-label="Installation log"
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={{ transform: open ? "translateY(0%)" : "translateY(-110%)" }}
        transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="installation-log fixed inset-x-0 top-0 z-40 flex h-[min(65dvh,32rem)] flex-col overflow-hidden rounded-b-xl text-left shadow-[0_12px_32px_#30282026]"
      >
        <div className="installation-log-toolbar flex min-h-14 shrink-0 items-center justify-end gap-3 pr-4 pl-44">
          <BaseButton
            onClick={copyLog}
            disabled={!entries.length}
            className="glass-button glass-button-neutral rounded-md border border-[#bcbab5] px-3 py-1 text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-50"
          >
            {copyStatus}
          </BaseButton>
        </div>
        <pre
          ref={scrollRef}
          role="log"
          aria-live="off"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard scrolling in the log.
          tabIndex={0}
          aria-label="Complete installation session log"
          className="installation-log-content min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-3 font-mono text-[11px] leading-6 text-body outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/50"
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            followLogRef.current = scrollHeight - scrollTop - clientHeight < 24;
          }}
        >
          {logText || "No events recorded yet."}
        </pre>
        <span className="sr-only" role="status">
          {copyStatus === "Copy log" ? "" : copyStatus}
        </span>
        <BaseButton
          onClick={close}
          aria-label="Collapse installation log"
          className="installation-log-toolbar flex h-7 w-full shrink-0 cursor-pointer items-center justify-center text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/50"
        >
          <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" fill="none">
            <path
              d="m3 7 6-4 6 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </BaseButton>
      </motion.section>
    </React.Fragment>
  );
};

export { DebugLog };
