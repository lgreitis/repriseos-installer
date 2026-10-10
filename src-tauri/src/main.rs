// Hide the console window in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod linux_graphics;

fn main() {
    linux_graphics::configure();
    repriseos_installer_lib::run()
}
