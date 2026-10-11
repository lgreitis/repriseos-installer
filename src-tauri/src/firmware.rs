use reprise_bundle::preparation::Ipsw;
use serde::Serialize;
use std::{
    fs,
    io::Write,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct FirmwareState(pub Mutex<Option<Arc<Ipsw>>>);

impl FirmwareState {
    pub fn selected(&self, sha256: &str) -> Result<Arc<Ipsw>, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .filter(|ipsw| ipsw.sha256 == sha256)
            .cloned()
            .ok_or_else(|| "Choose the IPSW again.".into())
    }
}

#[derive(Serialize)]
pub struct FirmwareInfo {
    filename: String,
    version: String,
    sha256: String,
}

#[tauri::command]
pub async fn choose_firmware(
    app: AppHandle,
    on_selected: Channel<String>,
) -> Result<Option<FirmwareInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FirmwareState>();
        let mut selected = state
            .0
            .try_lock()
            .map_err(|_| "Firmware is still loading.")?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose Apple firmware")
            .add_filter("Apple firmware", &["ipsw"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        *selected = None;
        on_selected
            .send(filename.clone())
            .map_err(|e| e.to_string())?;
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
            return Err("IPSW exceeds 128 MiB".into());
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let ipsw = Ipsw::parse(&bytes).map_err(|e| e.to_string())?;
        let cache = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("firmware");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let mut saved =
            fs::File::create(cache.join("iPod_38.2.0.5.ipsw")).map_err(|e| e.to_string())?;
        saved
            .write_all(&bytes)
            .and_then(|()| saved.sync_all())
            .map_err(|e| e.to_string())?;
        let info = FirmwareInfo {
            filename,
            version: ipsw.metadata.version(),
            sha256: ipsw.sha256.clone(),
        };
        *selected = Some(Arc::new(ipsw));
        Ok(Some(info))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cached_firmware(app: AppHandle) -> Result<Option<FirmwareInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FirmwareState>();
        let mut selected = state.0.lock().map_err(|e| e.to_string())?;
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("firmware/iPod_38.2.0.5.ipsw");
        if !path.try_exists().map_err(|e| e.to_string())? {
            return Ok(None);
        }
        let ipsw = Ipsw::load(&path)
            .map_err(|e| format!("Cached IPSW is invalid; choose the file again. {e}"))?;
        let info = FirmwareInfo {
            filename: "iPod_38.2.0.5.ipsw".into(),
            version: ipsw.metadata.version(),
            sha256: ipsw.sha256.clone(),
        };
        *selected = Some(Arc::new(ipsw));
        Ok(Some(info))
    })
    .await
    .map_err(|e| e.to_string())?
}
