use reprise_bundle::{TrustedKey, VerifiedBundle};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const RELEASE_PUBLIC_KEY: &str = "9d5d7c2777bd4e22ebac4d759effe8625c1b91b5a3e6aeae33ac64c3984b28ce";

#[derive(Deserialize)]
struct Release {
    draft: bool,
    published_at: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

fn newest_manifest(releases: Vec<Release>) -> Result<String, String> {
    let release = releases
        .into_iter()
        .filter(|release| !release.draft && release.published_at.is_some())
        .max_by(|a, b| a.published_at.cmp(&b.published_at))
        .ok_or(
            "No RepriseOS release has been published yet. Choose a local package to continue.",
        )?;
    release
        .assets
        .into_iter()
        .find(|asset| asset.name == "manifest.json")
        .map(|asset| asset.browser_download_url)
        .ok_or_else(|| "The newest RepriseOS release is missing its package manifest.".into())
}

fn latest_manifest_url() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("repriseos-installer/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut releases = Vec::new();
    for page in 1.. {
        let response = client
            .get("https://api.github.com/repos/lgreitis/osos-lab/releases")
            .header("Accept", "application/vnd.github+json")
            .query(&[("per_page", 100), ("page", page)])
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|e| format!("Could not check RepriseOS releases: {e}"))?;
        let batch: Vec<Release> = serde_json::from_reader(response).map_err(|e| e.to_string())?;
        let last_page = batch.len() < 100;
        releases.extend(batch);
        if last_page {
            break;
        }
    }
    newest_manifest(releases)
}

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
        let url = match option_env!("REPRISE_BUNDLE_MANIFEST_URL") {
            Some(url) => url.to_owned(),
            None => latest_manifest_url()?,
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
        let info = package_info(&bundle, None)?;
        *selected = Some(Arc::new(bundle));
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn newest_published_release_includes_prereleases_and_skips_drafts() {
        let release = |tag: &str, date: &str, draft: bool, prerelease: bool| {
            json!({
                "draft": draft,
                "prerelease": prerelease,
                "published_at": date,
                "assets": [{
                    "name": "manifest.json",
                    "browser_download_url": format!("https://github.com/lgreitis/osos-lab/releases/download/{tag}/manifest.json")
                }]
            })
        };
        let releases = serde_json::from_value(json!([
            release("v0.2.0", "2026-09-28T00:00:00Z", true, false),
            release("v0.1.0", "2026-09-25T00:00:00Z", false, false),
            release("v0.2.0-alpha.1", "2026-09-26T00:00:00Z", false, true)
        ]))
        .unwrap();
        assert_eq!(
            newest_manifest(releases).unwrap(),
            "https://github.com/lgreitis/osos-lab/releases/download/v0.2.0-alpha.1/manifest.json"
        );
        assert!(newest_manifest(Vec::new()).is_err());
    }
}
