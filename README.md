# RepriseOS Installer

Desktop app for installing RepriseOS, an enhanced version of Apple's original
iPod firmware. Validates firmware, backs up NOR/SysCfg, applies patches, uploads
RepriseOS, and installs the bootloader.
The installer uses Apple **2.0.5** for all supported iPod Classics.

## Compatibility

- iPod Classic 6G, 6.5G and 7G.
- FAT32 storage required.

## Install

Download RepriseOS Installer from [the website](https://repriseos.com/download/)
or [GitHub releases](https://github.com/lgreitis/repriseos-installer/releases).
Select **`iPod_38.2.0.5.ipsw`**, even if the iPod runs an older Apple firmware.
Follow the DFU instructions in the app. The installer downloads and verifies the
latest RepriseOS package.

## Development

Built with Tauri and React. Requires Node.js, pnpm, Rust, the Tauri platform
prerequisites, libusb, and pkg-config. Cargo fetches the shared Rust crates from
[osos-lab](https://github.com/lgreitis/osos-lab), pinned in `Cargo.toml` and `Cargo.lock`.

```sh
pnpm install
pnpm tauri dev
```

## Build and check

```sh
pnpm tauri build
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml -j 8
```

## Support

♥ [Support on Ko-fi](https://ko-fi.com/lgreitis). Help fund my questionable iPod purchases.
