import type { DeviceInfo } from "../lib/deviceChecks.ts";
import type { FirmwareInfo } from "../lib/installation.ts";
import type { PackageInfo } from "../lib/package.ts";

export const mockDevice: DeviceInfo = {
  selector: { bus: 1, address: 1 },
  port_path: [1],
  vendor_id: 0x05ac,
  product_id: 0x1223,
  mode: "DFU",
  dfu_candidate: true,
};

export const mockFirmware: FirmwareInfo = {
  filename: "iPod_38.2.0.5.ipsw",
  version: "2.0.5",
  sha256: "mock-firmware-sha256",
};

export const mockPackage: PackageInfo = {
  version: "0.1.1",
  digest: "mock-package-digest",
  filename: null,
};
