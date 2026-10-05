# RepriseOS Installer

Desktop app for installing RepriseOS, an enhanced version of Apple's original
iPod firmware. Validates firmware, backs up NOR/SysCfg, applies patches, uploads
RepriseOS, and installs the bootloader.
Backups and installation logs stay in the application's data directory.

Current support (FAT32 storage required):

- iPod Classic 6.5G / Rev A: MB562 and MB565, Apple firmware 2.0.1.
- iPod Classic 7G / Rev B: MC293 and MC297, Apple firmware 2.0.4.

## Run

Built with Tauri and React. Requires Node.js, pnpm, Rust, the Tauri platform
prerequisites, libusb, and pkg-config. Cargo fetches the shared Rust crates from
[osos-lab](https://github.com/lgreitis/osos-lab), using the revision in `Cargo.lock`.

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
