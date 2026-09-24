mod firmware;
mod job;
mod transfer;

use crate::{device::UsbState, firmware::FirmwareState, package::PackageState};
use job::Job;
pub use job::{InstallEvent, InstallResult};
use reprise_bundle::assembly;
use reprise_device::UploadHelper;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{ipc::Channel, AppHandle, Manager};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Default)]
pub struct InstallState {
    pub running: AtomicBool,
    cancellation: Mutex<Cancellation>,
}

#[derive(Default)]
struct Cancellation {
    requested: bool,
    allowed: bool,
}

struct Running<'a>(&'a InstallState);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub fn cancel_install(app: AppHandle) {
    let state = app.state::<InstallState>();
    if let Ok(mut cancellation) = state.cancellation.lock() {
        if cancellation.allowed {
            cancellation.requested = true;
        }
    };
}

#[tauri::command]
pub async fn install(
    app: AppHandle,
    firmware_sha256: String,
    package_digest: String,
    on_event: Channel<InstallEvent>,
) -> std::result::Result<InstallResult, String> {
    let operation = app
        .state::<UsbState>()
        .acquire()
        .map_err(|e| e.to_string())?;
    let state = app.state::<InstallState>();
    *state.cancellation.lock().map_err(|e| e.to_string())? = Cancellation {
        requested: false,
        allowed: true,
    };
    state.running.store(true, Ordering::Release);
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let state = app.state::<InstallState>();
        let _running = Running(&state);
        run(&app, &state, firmware_sha256, package_digest, on_event).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run(
    app: &AppHandle,
    state: &InstallState,
    firmware_sha256: String,
    package_digest: String,
    channel: Channel<InstallEvent>,
) -> Result<InstallResult> {
    let ipsw = app
        .state::<FirmwareState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .filter(|f| f.sha256 == firmware_sha256)
        .cloned()
        .ok_or("Choose the IPSW again.")?;
    let bundle = app
        .state::<PackageState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .filter(|b| b.digest() == package_digest)
        .cloned()
        .ok_or("Choose the package again.")?;
    let helper = UploadHelper::from_bytes(
        bundle.file("usb_helper", "image")?,
        bundle.file("usb_helper", "descriptor")?,
    )?;
    if !helper.supports_storage_inspection() {
        return Err("Choose a newer package with storage inspection support.".into());
    }
    assembly::nor_installer(&bundle)?;
    let checked = app
        .state::<UsbState>()
        .checked
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("Return to the DFU guide and check your iPod again.")?;
    let identity = checked
        .report
        .identity
        .as_ref()
        .ok_or("Missing checked device identity.")?;
    let target = &bundle.manifest().compatibility;
    if !target.models.contains(&identity.model)
        || target.hardware_version != identity.hardware_version
        || target.apple_firmware != identity.recorded_firmware
    {
        return Err("The package is incompatible with this iPod.".into());
    }
    let data = app.path().app_data_dir()?;
    let directory = job::backup_directory(&data, &identity.hardware_id)?;
    job::save_json(&directory.join("device.json"), &checked.report)?;
    job::save_json(
        &directory.join("inputs.json"),
        &serde_json::json!({"ipsw": ipsw.sha256, "bundle": bundle.digest()}),
    )?;
    let mut job = Job::new(state, channel, directory)?;
    let outcome = (|| {
        let mut session = transfer::inspect_storage(checked.session, &helper, &bundle, &mut job)?;
        let nor = firmware::backup(&mut session, identity, &mut job)?;
        let artifacts = firmware::assemble(&mut session, &ipsw, &nor, &bundle, &data, &mut job)?;
        transfer::install(session, &helper, &artifacts, &mut job)
    })();
    job.finish(outcome)
}
