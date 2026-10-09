mod platform;

use crate::device::UsbState;
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const FEED: &str =
    "https://github.com/lgreitis/repriseos-installer/releases/latest/download/latest.json";
const DOWNLOAD_PAGE: &str = "https://github.com/lgreitis/repriseos-installer/releases/latest";

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    pub installing: AtomicBool,
}

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateMode {
    Automatic,
    Manual,
    Disabled,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    current_version: String,
    version: Option<String>,
    mode: UpdateMode,
}

#[derive(Serialize)]
pub struct UpdateProgress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn mode(app: &AppHandle) -> UpdateMode {
    if cfg!(debug_assertions) {
        return UpdateMode::Disabled;
    }
    let automatic = std::env::current_exe().ok().is_some_and(|path| {
        platform::automatic_install(
            &path,
            app.path().home_dir().ok().as_deref(),
            tauri::utils::platform::bundle_type(),
        )
    });
    if automatic {
        UpdateMode::Automatic
    } else {
        UpdateMode::Manual
    }
}

#[tauri::command]
pub async fn check_installer_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let mode = mode(&app);
    let current_version = app.package_info().version.to_string();
    let mut info = UpdateInfo {
        current_version,
        version: None,
        mode,
    };
    if mode == UpdateMode::Disabled {
        return Ok(info);
    }
    if mode == UpdateMode::Manual {
        let current = app.package_info().version.clone();
        info.version = tauri::async_runtime::spawn_blocking(move || manual_update(&current))
            .await
            .map_err(|e| e.to_string())??;
        return Ok(info);
    }
    let update = app
        .updater_builder()
        .endpoints(vec![FEED.parse().unwrap()])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    info.version = update.as_ref().map(|update| update.version.clone());
    *app.state::<UpdateState>()
        .pending
        .lock()
        .map_err(|e| e.to_string())? = update;
    Ok(info)
}

fn manual_update(current: &semver::Version) -> Result<Option<String>, String> {
    #[derive(Deserialize)]
    struct Release {
        version: String,
    }
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("repriseos-installer/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?
        .get(FEED)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|e| e.to_string())?;
    let release: Release =
        serde_json::from_reader(response.take(256 * 1024)).map_err(|e| e.to_string())?;
    let version = semver::Version::parse(release.version.trim_start_matches('v'))
        .map_err(|e| e.to_string())?;
    Ok((version > *current).then(|| version.to_string()))
}

struct Installing<'a>(&'a AtomicBool);
impl Drop for Installing<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn install_installer_update(
    app: AppHandle,
    on_event: Channel<UpdateProgress>,
) -> Result<(), String> {
    if mode(&app) != UpdateMode::Automatic {
        return Err("This copy uses manual updates. Download the new installer.".into());
    }
    // Share the device gate for the entire download/install/restart operation.
    let _operation = app
        .state::<UsbState>()
        .acquire()
        .map_err(|e| e.to_string())?;
    let state = app.state::<UpdateState>();
    let update = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Check for an installer update first.")?;
    state.installing.store(true, Ordering::Release);
    let installing = Installing(&state.installing);
    let mut downloaded = 0;
    let bytes = update
        .download(
            |bytes, total| {
                downloaded += bytes as u64;
                let _ = on_event.send(UpdateProgress {
                    stage: "downloading",
                    downloaded,
                    total,
                });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = on_event.send(UpdateProgress {
        stage: "installing",
        downloaded,
        total: Some(downloaded),
    });
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    drop(installing);
    app.restart();
}

#[tauri::command]
pub async fn open_installer_download(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(DOWNLOAD_PAGE, None::<&str>)
        .map_err(|e| e.to_string())
}
