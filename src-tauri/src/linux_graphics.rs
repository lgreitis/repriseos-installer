// Apply before Tauri/GTK starts threads or creates a display.
// https://v2.tauri.app/develop/debug/linux-graphics/
// https://bugs.webkit.org/show_bug.cgi?id=324551
pub fn configure() {
    #[cfg(target_os = "linux")]
    {
        let compatibility = std::env::args().any(|arg| arg == "--graphics-compatibility");
        if compatibility && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            eprintln!("Graphics compatibility: WebKitGTK DMABUF rendering disabled.");
        }

        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty())
            || std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value == "wayland");
        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let backend = std::env::var("GDK_BACKEND").ok();
        if wayland
            && nvidia
            && backend.as_deref() != Some("x11")
            && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
        {
            // Preserve accelerated rendering while avoiding the NVIDIA/Wayland
            // protocol error. User-provided settings always take precedence.
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
            eprintln!("NVIDIA/Wayland graphics workaround: explicit sync disabled.");
        }
    }
}
