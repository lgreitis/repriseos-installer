import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PackageInfo {
  version: string;
  digest: string;
  filename: string | null;
}

export async function chooseLocalPackage(): Promise<PackageInfo | null> {
  if (!isTauri()) throw new Error("Open the desktop installer to load a package.");
  return invoke<PackageInfo | null>("choose_local_package");
}

export async function preparePackage(
  firmwareSha256: string,
  localPackage: PackageInfo | null,
): Promise<PackageInfo> {
  if (!isTauri()) throw new Error("Open the desktop installer to load a package.");
  return invoke<PackageInfo>("prepare_package", {
    firmwareSha256,
    localDigest: localPackage?.digest ?? null,
  });
}
