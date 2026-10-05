mod releases;
#[cfg(test)]
mod tests;

use crate::firmware::FirmwareState;
use reprise_bundle::{TrustedKey, VerifiedBundle};
use reprise_device::targets::Target;
use serde::Serialize;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const RELEASE_PUBLIC_KEY: &str = "9d5d7c2777bd4e22ebac4d759effe8625c1b91b5a3e6aeae33ac64c3984b28ce";

#[derive(Default)]
pub struct PackageState(pub Mutex<Option<Arc<VerifiedBundle>>>);

#[derive(Serialize)]
pub struct PackageInfo {
    version: String,
    digest: String,
    filename: Option<String>,
}

fn package_info(bundle: &VerifiedBundle, filename: Option<String>) -> Result<PackageInfo, String> {
    for component in ["usb_helper", "osos", "companion", "nor"] {
        if !bundle.manifest().components.contains_key(component) {
            return Err(format!("Package is missing the {component} component."));
        }
    }
    reprise_device::UploadHelper::from_bytes(
        bundle
            .file("usb_helper", "image")
            .map_err(|e| e.to_string())?,
        bundle
            .file("usb_helper", "descriptor")
            .map_err(|e| e.to_string())?,
    )
    .and_then(|helper| helper.validate_platform())
    .map_err(|e| e.to_string())?;
    reprise_bundle::assembly::disk_bytes(bundle).map_err(|e| e.to_string())?;
    reprise_bundle::assembly::nor_installer(bundle).map_err(|e| e.to_string())?;
    Ok(PackageInfo {
        version: bundle.manifest().version.clone(),
        digest: bundle.digest().to_owned(),
        filename,
    })
}

#[tauri::command]
pub async fn choose_local_package(app: AppHandle) -> Result<Option<PackageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PackageState>();
        let mut selected = state
            .0
            .try_lock()
            .map_err(|_| "A package is still loading.")?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose a RepriseOS package")
            .add_filter("RepriseOS package", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let bundle = VerifiedBundle::load_local_zip(&path, env!("CARGO_PKG_VERSION"))
            .map_err(|e| e.to_string())?;
        let info = package_info(
            &bundle,
            path.file_name().map(|n| n.to_string_lossy().into_owned()),
        )?;
        *selected = Some(Arc::new(bundle));
        Ok(Some(info))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_package(
    app: AppHandle,
    local_digest: Option<String>,
    firmware_sha256: String,
) -> Result<PackageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PackageState>();
        let mut selected = state
            .0
            .try_lock()
            .map_err(|_| "A package is still loading.")?;
        let ipsw = app.state::<FirmwareState>().selected(&firmware_sha256)?;
        let target = ipsw.metadata.target().map_err(|e| e.to_string())?;
        if let Some(digest) = local_digest {
            let bundle = selected
                .as_ref()
                .filter(|b| b.digest() == digest)
                .ok_or("Choose the local package again.")?;
            require_target(&bundle.manifest().compatibility, target)?;
            return package_info(bundle, None);
        }
        let url = match option_env!("REPRISE_BUNDLE_MANIFEST_URL") {
            Some(url) => url.to_owned(),
            None => releases::latest_manifest_url(&target.target)?,
        };
        let key = option_env!("REPRISE_BUNDLE_PUBLIC_KEY").unwrap_or(RELEASE_PUBLIC_KEY);
        let key = TrustedKey::from_hex(key).map_err(|e| e.to_string())?;
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("bundles");
        let (_, bundle) =
            reprise_bundle::fetch(&url, None, &key, &cache, env!("CARGO_PKG_VERSION"))
                .map_err(|e| e.to_string())?;
        require_target(&bundle.manifest().compatibility, target)?;
        let info = package_info(&bundle, None)?;
        *selected = Some(Arc::new(bundle));
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn require_target(
    compatibility: &reprise_bundle::Compatibility,
    target: &Target,
) -> Result<(), String> {
    if compatibility.target != target.target {
        return Err(format!(
            "This package is for {}. Choose a package for Apple {} ({}).",
            compatibility.target,
            target.ipsw.version,
            target.compatibility.models.join(" / ")
        ));
    }
    Ok(())
}

pub(crate) fn require_device(
    compatibility: &reprise_bundle::Compatibility,
    report: &reprise_device::CheckReport,
) -> Result<(), String> {
    let identity = report
        .identity
        .as_ref()
        .ok_or("Missing checked device identity.")?;
    if !compatibility.matches_identity(
        &identity.model,
        identity.hardware_version,
        &identity.recorded_firmware,
    ) || report.bootrom_sha256.as_deref() != Some(&compatibility.bootrom_sha256)
    {
        return Err(format!(
            "The selected firmware package does not support this {} iPod. Choose the IPSW and package for this model.",
            identity.model
        ));
    }
    Ok(())
}
