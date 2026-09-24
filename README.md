# RepriseOS Installer

Tauri + React desktop app for installing RepriseOS on iPod. Validates firmware,
backs up NOR/SysCfg, assembles and uploads RepriseOS, and installs the bootloader.
Backups and installation logs stay in the application's data directory.

> Current support: iPod Classic 7G Rev B, Apple 2.0.4, FAT32. Support for more models is planned.

## Run

Requires Node.js, pnpm, Rust, the Tauri platform prerequisites, libusb, and
pkg-config. Check out `osos-lab` beside this repository for its Rust crates.

```sh
pnpm install
pnpm tauri dev
```

Choose a compatible IPSW and use **Alternatively, choose a local package…** for
a bundle ZIP. Automatic downloads require `REPRISE_BUNDLE_MANIFEST_URL` and
`REPRISE_BUNDLE_PUBLIC_KEY` (hex Ed25519 public key) at build time.

## Build and check

```sh
pnpm tauri build
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml -j 8
```
