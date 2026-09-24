import { cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type React from "react";
import { cn } from "../../lib/cn";

type CheckStatus = "pending" | "checking" | "passed" | "failed" | "skipped";

const checkItemVariants = cva(
  "group flex min-h-9 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-200",
  {
    variants: {
      status: {
        pending: "text-muted",
        checking: "bg-black/[0.025] text-ink",
        passed: "text-ink",
        failed: "text-[#aa3e36]",
        skipped: "text-muted",
      },
    },
  },
);

interface ICheckStatusIndicatorProps {
  status: CheckStatus;
}

export const CheckStatusIndicator: React.FC<ICheckStatusIndicatorProps> = ({ status }) => {
  const reducedMotion = useReducedMotion();

  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <AnimatePresence mode="wait">
        <motion.span
          key={status}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.12 }}
        >
          {status === "failed" || status === "skipped" ? (
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
              <path
                d={status === "failed" ? "m7 7 6 6m0-6-6 6" : "M6 10h8"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : status === "pending" ? (
            <span className="size-3 rounded-full border border-black/15" />
          ) : status === "checking" ? (
            <motion.svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              animate={{ rotate: reducedMotion ? 0 : 360 }}
              transition={{ duration: 0.8, ease: "linear", repeat: reducedMotion ? 0 : Infinity }}
            >
              <circle
                cx="10"
                cy="10"
                r="7.5"
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth="1.8"
              />
              <path
                d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </motion.svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="#609064" />
              <path
                d="m5.8 10 2.7 2.8 5.7-5.7"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

interface ICheckListRootProps extends React.ComponentProps<"ul"> {}

const CheckListRoot: React.FC<ICheckListRootProps> = ({ className, ...props }) => {
  return (
    <ul
      className={cn(
        "mx-auto space-y-1 rounded-2xl border border-[#d4d1cb] bg-[#f8f7f4]/90 p-4 shadow-[inset_0_1px_0_#ffffff,0_2px_8px_#3a332b08] sm:p-5",
        className,
      )}
      {...props}
    />
  );
};

interface ICheckListItemProps extends React.ComponentProps<"li"> {
  status: CheckStatus;
}

const CheckListItem: React.FC<ICheckListItemProps> = ({
  status,
  className,
  children,
  ...props
}) => {
  return (
    <li className={cn(checkItemVariants({ status }), className)} data-status={status} {...props}>
      <CheckStatusIndicator status={status} />
      {children}
    </li>
  );
};

interface ICheckListLabelProps extends React.ComponentProps<"span"> {}

const CheckListLabel: React.FC<ICheckListLabelProps> = ({ className, ...props }) => {
  return (
    <span
      className={cn("min-w-0 flex-1 text-[13px] leading-5 font-medium", className)}
      {...props}
    />
  );
};

interface ICheckListResultProps extends React.ComponentProps<"span"> {}

const CheckListResult: React.FC<ICheckListResultProps> = ({ className, ...props }) => {
  return <span className={cn("shrink-0 text-[12px] leading-5 text-muted", className)} {...props} />;
};

export const CheckList = {
  Root: CheckListRoot,
  Item: CheckListItem,
  Label: CheckListLabel,
  Result: CheckListResult,
};

export type { CheckStatus };
