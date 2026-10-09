import { motion, useReducedMotion } from "framer-motion";
import React from "react";
import ipodClassic from "../../assets/iPodClassic.png";
import { cn } from "../../lib/cn";

interface IIpodIllustrationProps {
  className?: string;
  onLoad?: () => void;
  showHighlights: boolean;
}

const IpodIllustration: React.FC<IIpodIllustrationProps> = ({
  className,
  onLoad,
  showHighlights,
}) => {
  const glowId = React.useId();
  const reducedMotion = useReducedMotion();

  return (
    <div className={cn("relative h-full w-fit select-none", className)}>
      <img
        src={ipodClassic}
        alt={
          showHighlights
            ? "iPod classic with its Menu and center buttons highlighted in blue"
            : "iPod classic with its screen, Menu button, and center button visible"
        }
        width={1024}
        height={1024}
        draggable={false}
        onLoad={onLoad}
        className="block h-full w-auto"
      />
      {showHighlights && (
        <motion.svg
          viewBox="0 0 1024 1024"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
          initial={{ opacity: reducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.4, ease: "easeInOut" }}
        >
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0" stopColor="#2997ff" stopOpacity="0.28" />
              <stop offset="0.6" stopColor="#2997ff" stopOpacity="0.2" />
              <stop offset="1" stopColor="#2997ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <motion.g
            initial={{ opacity: 1 }}
            animate={{ opacity: reducedMotion ? 1 : [1, 0.6, 1] }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { delay: 0.4, duration: 2, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <g transform="translate(512 558)">
              <circle r="67" fill={`url(#${glowId})`} />
              <circle r="43" fill="#2997ff" fillOpacity="0.2" />
            </g>
            <g transform="translate(512 708)">
              <circle r="98" fill={`url(#${glowId})`} />
              <circle r="66" fill="#2997ff" fillOpacity="0.2" />
            </g>
          </motion.g>
        </motion.svg>
      )}
    </div>
  );
};

export { IpodIllustration };
