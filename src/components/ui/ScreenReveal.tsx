import { motion, useReducedMotion } from "framer-motion";
import type React from "react";

interface IScreenRevealProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

const ScreenReveal: React.FC<IScreenRevealProps> = ({ children, delay = 0, className }) => {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.4,
        delay: reducedMotion ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
};

export { ScreenReveal };
