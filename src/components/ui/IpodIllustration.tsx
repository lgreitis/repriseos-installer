import type React from "react";
import ipodClassic from "../../assets/iPodClassic.svg";
import { cn } from "../../lib/cn";

interface IIpodIllustrationProps {
  className?: string;
  onLoad?: () => void;
}

const IpodIllustration: React.FC<IIpodIllustrationProps> = ({ className, onLoad }) => {
  return (
    <img
      src={ipodClassic}
      alt="iPod classic with its screen, Menu button, and center button visible"
      width={443}
      height={729}
      draggable={false}
      onLoad={onLoad}
      className={cn("block h-full w-auto select-none", className)}
    />
  );
};

export { IpodIllustration };
