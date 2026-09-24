import { Collapsible } from "@base-ui/react/collapsible";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";

interface IHelpDisclosureProps {
  label: string;
  children: React.ReactNode;
}

const HelpDisclosure: React.FC<IHelpDisclosureProps> = ({ label, children }) => {
  const [open, setOpen] = React.useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mx-auto mt-6 max-w-125">
      <Collapsible.Trigger className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-body outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/50">
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className="text-[10px] text-muted"
        >
          ▶
        </motion.span>
        {label}
      </Collapsible.Trigger>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{
          height: { duration: reducedMotion ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] },
          opacity: { duration: reducedMotion ? 0 : 0.22, delay: open && !reducedMotion ? 0.06 : 0 },
        }}
        className="overflow-hidden"
        inert={!open}
        aria-hidden={!open}
      >
        <Collapsible.Panel keepMounted hidden={false} className="flow-root">
          <div className="installer-well mt-3 rounded-lg px-5 py-4 text-left text-[13px] leading-6 text-body [&_p+p]:mt-3 [&_strong]:font-bold [&_strong]:text-ink">
            {children}
          </div>
        </Collapsible.Panel>
      </motion.div>
    </Collapsible.Root>
  );
};

export { HelpDisclosure };
