use std::path::Path;
use tauri::utils::config::BundleType;

pub(super) fn automatic_install(
    executable: &Path,
    home: Option<&Path>,
    bundle: Option<BundleType>,
) -> bool {
    match bundle {
        Some(BundleType::App) => installed_mac_app(executable, home),
        Some(BundleType::Nsis) => executable.parent().is_some_and(|directory| {
            installed_nsis_directory(directory).is_some_and(|installed| {
                directory
                    .canonicalize()
                    .is_ok_and(|current| current == installed)
            })
        }),
        _ => false,
    }
}

fn installed_nsis_directory(directory: &Path) -> Option<std::path::PathBuf> {
    let bytes = std::fs::read(directory.join(".repriseos-nsis")).ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let words: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    let path = String::from_utf16(&words).ok()?;
    Path::new(path.trim_start_matches('\u{feff}'))
        .canonicalize()
        .ok()
}

fn installed_mac_app(executable: &Path, home: Option<&Path>) -> bool {
    let Some(macos) = executable.parent() else {
        return false;
    };
    let Some(contents) = macos.parent() else {
        return false;
    };
    let Some(app) = contents.parent() else {
        return false;
    };
    if macos.file_name().is_none_or(|name| name != "MacOS")
        || contents.file_name().is_none_or(|name| name != "Contents")
        || app.extension().is_none_or(|extension| extension != "app")
    {
        return false;
    }
    app.starts_with("/Applications")
        || home.is_some_and(|home| app.starts_with(home.join("Applications")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_installed_mac_apps_can_replace_themselves() {
        let home = Some(Path::new("/Users/test"));
        for path in [
            "/Applications/RepriseOS.app/Contents/MacOS/app",
            "/Users/test/Applications/RepriseOS.app/Contents/MacOS/app",
        ] {
            assert!(automatic_install(
                Path::new(path),
                home,
                Some(BundleType::App)
            ));
        }
        for path in [
            "/Volumes/RepriseOS/RepriseOS.app/Contents/MacOS/app",
            "/Users/test/Downloads/RepriseOS.app/Contents/MacOS/app",
            "/Applications/app",
        ] {
            assert!(!automatic_install(
                Path::new(path),
                home,
                Some(BundleType::App)
            ));
        }
        assert!(!automatic_install(Path::new("/tmp/app.exe"), None, None));
        assert!(!automatic_install(
            Path::new("/tmp/app.exe"),
            None,
            Some(BundleType::Nsis)
        ));
    }
    #[test]
    fn nsis_marker_is_bound_to_its_install_directory() {
        let root = std::env::temp_dir().join(format!("reprise-updater-{}", std::process::id()));
        let installed = root.join("installed-é");
        let portable = root.join("portable");
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::create_dir_all(&portable).unwrap();
        let marker: Vec<u8> = installed
            .to_str()
            .unwrap()
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        for directory in [&installed, &portable] {
            std::fs::write(directory.join(".repriseos-nsis"), &marker).unwrap();
        }
        assert!(automatic_install(
            &installed.join("app.exe"),
            None,
            Some(BundleType::Nsis)
        ));
        assert!(!automatic_install(
            &portable.join("app.exe"),
            None,
            Some(BundleType::Nsis)
        ));
        assert!(!automatic_install(&installed.join("app.exe"), None, None));
        std::fs::remove_dir_all(root).unwrap();
    }
}
