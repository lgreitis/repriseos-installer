import type React from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

interface IChoiceButtonProps
  extends Omit<React.ComponentProps<typeof Button.Root>, "children" | "title"> {
  title: string;
  description: string;
}

const ChoiceButton: React.FC<IChoiceButtonProps> = ({
  title,
  description,
  className,
  ...props
}) => {
  return (
    <Button.Root
      className={cn("h-auto min-h-24 w-full justify-start rounded-xl py-5 text-left", className)}
      {...props}
    >
      <Button.Label>
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="mt-2 block text-[12px] leading-5 font-normal text-body">
          {description}
        </span>
      </Button.Label>
    </Button.Root>
  );
};

export { ChoiceButton };
