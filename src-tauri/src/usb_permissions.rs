// Only the helper needs an additional Linux access rule.
#[cfg(target_os = "linux")]
const RULE: &str = include_str!("../linux/70-repriseos.rules");

#[tauri::command]
pub fn usb_permissions_ready() -> bool {
    #[cfg(target_os = "linux")]
    {
        // /etc takes precedence over package-owned rules in /usr/lib.
        for path in [
            "/etc/udev/rules.d/70-repriseos.rules",
            "/run/udev/rules.d/70-repriseos.rules",
            "/usr/local/lib/udev/rules.d/70-repriseos.rules",
            "/usr/lib/udev/rules.d/70-repriseos.rules",
        ] {
            if std::path::Path::new(path).symlink_metadata().is_ok() {
                return std::fs::read_to_string(path)
                    .is_ok_and(|installed| rules_match(&installed, RULE));
            }
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    true
}

#[cfg(target_os = "linux")]
fn rules_match(installed: &str, expected: &str) -> bool {
    fn lines(text: &str) -> impl Iterator<Item = &str> {
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
    }
    lines(installed).eq(lines(expected))
}

#[cfg(target_os = "linux")]
fn setup_result(code: Option<i32>) -> Result<(), String> {
    match code {
        Some(0) => Ok(()),
        Some(126) => Err("Administrator authentication was cancelled. Try again to enable iPod access.".into()),
        Some(127) => Err("Administrator authentication is unavailable or was denied. Make sure polkit and a desktop authentication agent are installed and running, then try again.".into()),
        _ => Err("USB access setup failed. Try again; if it still fails, see the Linux setup instructions in the project README.".into()),
    }
}

#[tauri::command]
pub async fn enable_usb_access(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let operation = app
            .state::<crate::device::UsbState>()
            .acquire()
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            let _operation = operation;
            // Script and destination are compiled in; IPC accepts no paths or shell text.
            let script = format!(
                "set -eu\ninstall -d -m 755 /etc/udev/rules.d\n\
                 umask 022\ncat > /etc/udev/rules.d/70-repriseos.rules <<'REPRISE_RULE'\n\
                 {RULE}REPRISE_RULE\nchmod 644 /etc/udev/rules.d/70-repriseos.rules\n\
                 udevadm control --reload-rules\n"
            );
            let status = std::process::Command::new("pkexec")
                // A GUI app cannot handle pkexec's fallback terminal prompt.
                .args(["--disable-internal-agent", "/bin/sh", "-c", &script])
                .status()
                .map_err(|error| format!("Could not start administrator authentication: {error}. Make sure pkexec (polkit) and a desktop authentication agent are installed."))?;
            setup_result(status.code())?;
            if !usb_permissions_ready() {
                return Err("The USB access rule could not be verified.".into());
            }
            Ok(())
        }).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn authentication_failures_do_not_report_success() {
        assert!(setup_result(Some(0)).is_ok());
        assert!(setup_result(Some(126)).unwrap_err().contains("cancelled"));
        assert!(setup_result(Some(127))
            .unwrap_err()
            .contains("authentication agent"));
        assert!(setup_result(Some(1)).unwrap_err().contains("setup failed"));
        assert!(setup_result(None).is_err());
    }

    #[test]
    fn verifies_active_rules_without_requiring_comment_identity() {
        let active = RULE.lines().find(|line| !line.starts_with('#')).unwrap();
        assert!(rules_match(&format!("# Local comment\n\n{active}\n"), RULE));
        assert!(!rules_match("", RULE));
        assert!(!rules_match(&RULE.replace("180d", "180e"), RULE));
        assert!(!rules_match(
            &format!("{RULE}SUBSYSTEM==\"usb\", MODE=\"0000\"\n"),
            RULE
        ));
    }
}
