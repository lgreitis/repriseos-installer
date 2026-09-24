import type React from "react";
import { cn } from "../../lib/cn";

interface IInstallerScreenRootProps extends React.ComponentProps<"section"> {}

const InstallerScreenRoot: React.FC<IInstallerScreenRootProps> = ({ className, ...props }) => {
  return <section className={cn("relative mx-auto w-full text-center", className)} {...props} />;
};

interface IInstallerScreenTitleProps extends React.ComponentProps<"h1"> {}

const InstallerScreenTitle: React.FC<IInstallerScreenTitleProps> = ({ className, ...props }) => {
  return (
    <h1
      className={cn(
        "text-[32px] leading-tight font-bold tracking-[-0.045em] text-ink outline-none sm:text-[38px]",
        className,
      )}
      {...props}
    />
  );
};

interface IInstallerScreenDescriptionProps extends React.ComponentProps<"p"> {}

const InstallerScreenDescription: React.FC<IInstallerScreenDescriptionProps> = ({
  className,
  ...props
}) => {
  return (
    <p
      className={cn(
        "mx-auto mt-6 max-w-135 text-[15px] leading-[1.85] text-body sm:text-[16px]",
        className,
      )}
      {...props}
    />
  );
};

interface IInstallerScreenActionsProps extends React.ComponentProps<"div"> {}

const InstallerScreenActions: React.FC<IInstallerScreenActionsProps> = ({
  className,
  ...props
}) => {
  return (
    <div
      className={cn("mt-9 flex flex-wrap items-center justify-center gap-3", className)}
      {...props}
    />
  );
};

export const InstallerScreen = {
  Root: InstallerScreenRoot,
  Title: InstallerScreenTitle,
  Description: InstallerScreenDescription,
  Actions: InstallerScreenActions,
};
