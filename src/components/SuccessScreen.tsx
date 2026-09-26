import type React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { Button } from "./ui/Button";
import { InstallerScreen } from "./ui/InstallerScreen";
import { SuccessSymbol } from "./ui/SuccessSymbol";

interface ISuccessScreenProps {
  onDone: () => void;
}

const bootOptions = [
  { controls: "Hold MENU", system: "RetailOS (original Apple OS)" },
  { controls: "No buttons", system: "RepriseOS" },
  { controls: "Hold Play/Pause", system: "Rockbox (if installed separately)" },
];

const SuccessScreen: React.FC<ISuccessScreenProps> = ({ onDone }) => {
  const { headingRef } = useHeadingFocus();

  return (
    <InstallerScreen.Root aria-labelledby="success-title">
      <div className="mx-auto mb-8 size-20">
        <SuccessSymbol />
      </div>
      <InstallerScreen.Title id="success-title" ref={headingRef} tabIndex={-1}>
        You’re all set.
      </InstallerScreen.Title>
      <InstallerScreen.Description className="max-w-125">
        Your iPod will restart. Once it restarts, disconnect USB.
      </InstallerScreen.Description>
      <div className="mx-auto mt-7 max-w-125">
        <p className="text-[13px] leading-6 text-body">Choose a system as your iPod starts:</p>
        <dl className="mt-4 rounded-2xl border border-[#d4d1cb] bg-[#f8f7f4]/90 px-5 py-2 text-[13px] shadow-[inset_0_1px_0_#ffffff,0_2px_6px_#30282006]">
          {bootOptions.map(({ controls, system }) => (
            <div
              key={system}
              className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-b border-[#e2dfd9] py-3 text-left last:border-0"
            >
              <dt className="text-body">{controls}</dt>
              <dd className="font-medium text-ink">{system}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] leading-5 text-muted">
          To restart manually, hold Menu + Center until the screen goes black, then release both
          buttons to start RepriseOS.
        </p>
      </div>
      <InstallerScreen.Actions className="mt-7">
        <Button.Root className="min-w-40" onClick={onDone}>
          <Button.Label>Done</Button.Label>
        </Button.Root>
      </InstallerScreen.Actions>
    </InstallerScreen.Root>
  );
};

export { SuccessScreen };
