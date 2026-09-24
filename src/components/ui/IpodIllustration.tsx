import { motion, useReducedMotion } from "framer-motion";
import React from "react";
import ipodClassic from "../../assets/iPodClassic.svg";
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
        width={443.19766}
        height={728.93097}
        draggable={false}
        onLoad={onLoad}
        className="block h-full w-auto"
      />
      {showHighlights && (
        <motion.svg
          viewBox="0 0 443.19766 728.93097"
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
            {/* Coordinates include the artwork's layer and Menu lettering transforms. */}
            <g transform="translate(214.85 418.04)">
              <circle r="50" fill={`url(#${glowId})`} />
              <circle r="32" fill="#2997ff" fillOpacity="0.2" />
            </g>
            <g transform="translate(214.81616 531.13194)">
              <circle r="73" fill={`url(#${glowId})`} />
              <circle r="49.08599" fill="#2997ff" fillOpacity="0.2" />
            </g>
          </motion.g>
        </motion.svg>
      )}
    </div>
  );
};

export { IpodIllustration };
