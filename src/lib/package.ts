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

export async function preparePackage(localPackage: PackageInfo | null): Promise<PackageInfo> {
  if (!isTauri()) throw new Error("Open the desktop installer to load a package.");
  return invoke<PackageInfo>("prepare_package", { localDigest: localPackage?.digest ?? null });
}
