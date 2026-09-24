import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "glass-button relative isolate inline-flex shrink-0 touch-none select-none items-center justify-center overflow-hidden rounded-[10px] border font-medium outline-none transition-[box-shadow,filter] duration-150 focus-visible:ring-3 focus-visible:ring-focus/50 focus-visible:ring-offset-3 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      intent: {
        neutral: "glass-button-neutral border-[#c2bfba] text-ink",
        danger: "glass-button-danger border-[#aa3e36] text-white",
      },
      size: {
        default: "h-12 min-w-28 gap-3 px-6 text-[14px]",
        compact: "h-10 gap-2 px-4 text-[13px]",
      },
    },
    defaultVariants: { intent: "neutral", size: "default" },
  },
);

interface IButtonRootProps
  extends Omit<React.ComponentProps<typeof BaseButton>, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

const ButtonRoot: React.FC<IButtonRootProps> = ({ className, intent, size, ...props }) => {
  return <BaseButton className={cn(buttonVariants({ intent, size }), className)} {...props} />;
};

interface IButtonLabelProps extends React.ComponentProps<"span"> {}

const ButtonLabel: React.FC<IButtonLabelProps> = ({ className, ...props }) => {
  return <span className={cn("relative z-20", className)} {...props} />;
};

export const Button = { Root: ButtonRoot, Label: ButtonLabel };
