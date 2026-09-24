mod device;
mod firmware;
mod install;
mod package;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(device::UsbState::default())
        .manage(package::PackageState::default())
        .manage(firmware::FirmwareState::default())
        .manage(install::InstallState::default())
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<install::InstallState>()
                    .running
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            device::discover_devices,
            device::check_device,
            package::choose_local_package,
            package::prepare_package,
            firmware::choose_firmware,
            install::install,
            install::cancel_install
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            use tauri::Manager;
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app
                    .state::<install::InstallState>()
                    .running
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    api.prevent_exit();
                }
            }
        });
}
