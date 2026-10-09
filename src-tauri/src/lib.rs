mod device;
mod firmware;
mod install;
mod package;
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
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
                    || window
                        .state::<updates::UpdateState>()
                        .installing
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
            updates::check_installer_update,
            updates::install_installer_update,
            updates::open_installer_download,
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
                    || app
                        .state::<updates::UpdateState>()
                        .installing
                        .load(std::sync::atomic::Ordering::Acquire)
                {
                    api.prevent_exit();
                }
            }
        });
}
