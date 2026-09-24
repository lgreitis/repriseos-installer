import { Progress } from "@base-ui/react/progress";
import { motion, useReducedMotion } from "framer-motion";
import type React from "react";

interface IInstallationProgressProps {
  label: string;
  value: number | null;
  complete: boolean;
  stage: string;
}

const InstallationProgress: React.FC<IInstallationProgressProps> = ({
  label,
  value,
  complete,
  stage,
}) => {
  const reducedMotion = useReducedMotion();

  return (
    <Progress.Root value={complete ? 100 : value} aria-label={label}>
      <Progress.Track className="relative h-[18px] overflow-hidden rounded-full border border-[#9babb6] bg-[#dbe0e3] shadow-[inset_0_1px_3px_#36495826,0_1px_0_#ffffff]">
        <motion.div
          key={stage}
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-[#6baddb]"
          initial={false}
          animate={{ width: `${value ?? 100}%` }}
          transition={{ duration: reducedMotion ? 0 : 0.12, ease: "linear" }}
        >
          <motion.div
            className="absolute inset-y-0 -left-8 right-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(115deg, transparent 0px, transparent 14.5px, #ffffff45 14.5px, #ffffff45 29px)",
              backgroundSize: "32px 100%",
            }}
            animate={{ x: reducedMotion || complete ? 0 : [0, 32] }}
            transition={{
              duration: 0.85,
              repeat: reducedMotion || complete ? 0 : Number.POSITIVE_INFINITY,
              ease: "linear",
            }}
          />
          <div className="absolute inset-0 rounded-full bg-[linear-gradient(180deg,#ffffff65_0%,#ffffff18_45%,#347ca422_55%,#2a71922b_100%)] shadow-[inset_0_1px_0_#ffffff80]" />
        </motion.div>
      </Progress.Track>
    </Progress.Root>
  );
};

export { InstallationProgress };
