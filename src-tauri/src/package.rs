use reprise_bundle::{TrustedKey, VerifiedBundle};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

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
) -> Result<PackageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PackageState>();
        let mut selected = state
            .0
            .try_lock()
            .map_err(|_| "A package is still loading.")?;
        if let Some(digest) = local_digest {
            let bundle = selected
                .as_ref()
                .filter(|b| b.digest() == digest)
                .ok_or("Choose the local package again.")?;
            return package_info(bundle, None);
        }
        let url = option_env!("REPRISE_BUNDLE_MANIFEST_URL").ok_or(
            "Automatic downloads are not configured yet. Choose a local package to continue.",
        )?;
        let key = option_env!("REPRISE_BUNDLE_PUBLIC_KEY").ok_or(
            "The release signing key is not configured. Choose a local package to continue.",
        )?;
        let key = TrustedKey::from_hex(key).map_err(|e| e.to_string())?;
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("bundles");
        let (_, bundle) = reprise_bundle::fetch(url, None, &key, &cache, env!("CARGO_PKG_VERSION"))
            .map_err(|e| e.to_string())?;
        let info = package_info(&bundle, None)?;
        *selected = Some(Arc::new(bundle));
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}
