import type React from "react";
import { useHeadingFocus } from "../hooks/useHeadingFocus";
import { ChoiceButton } from "./ui/ChoiceButton";
import { InstallerScreen } from "./ui/InstallerScreen";

interface IMainScreenProps {
  onInstall: () => void;
}

const MainScreen: React.FC<IMainScreenProps> = ({ onInstall }) => {
  const { headingRef } = useHeadingFocus();

  return (
    <InstallerScreen.Root aria-labelledby="main-title">
      <InstallerScreen.Title id="main-title" ref={headingRef} tabIndex={-1}>
        RepriseOS
      </InstallerScreen.Title>
      <InstallerScreen.Actions className="mx-auto mt-9 max-w-100 flex-col gap-3">
        <ChoiceButton
          title="Install RepriseOS"
          description="Set up your iPod for the first time."
          onClick={onInstall}
        />
        <ChoiceButton disabled title="Update RepriseOS" description="Not available yet." />
      </InstallerScreen.Actions>
    </InstallerScreen.Root>
  );
};

export { MainScreen };
