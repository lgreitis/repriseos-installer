import React from "react";
import {
  checkInstallerUpdate,
  dismissUpdate,
  getUpdateState,
  installInstallerUpdate,
  openInstallerDownload,
  subscribeToUpdates,
} from "../lib/updates";
import { InstallerUpdate } from "./InstallerUpdate";

export function InstallerUpdates() {
  const state = React.useSyncExternalStore(subscribeToUpdates, getUpdateState);
  React.useEffect(() => {
    if (getUpdateState().status === "idle") void checkInstallerUpdate();
  }, []);
  return (
    <InstallerUpdate
      state={state}
      onCheck={() => void checkInstallerUpdate()}
      onInstall={() => void installInstallerUpdate()}
      onDownload={() => void openInstallerDownload()}
      onLater={dismissUpdate}
    />
  );
}
