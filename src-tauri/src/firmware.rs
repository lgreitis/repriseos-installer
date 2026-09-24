use reprise_bundle::preparation::Ipsw;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct FirmwareState(pub Mutex<Option<Arc<Ipsw>>>);

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
        let ipsw = Ipsw::load(&path).map_err(|e| e.to_string())?;
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
