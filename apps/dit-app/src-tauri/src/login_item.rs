//! Start at login: a LaunchAgent in `~/Library/LaunchAgents`, written by the autostart plugin. The setting is the
//! file itself, read each time, never a copy kept in the config.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Whether the LaunchAgent is in place. A reading that fails is "off".
pub fn enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Writes or removes the LaunchAgent.
pub fn set(app: &AppHandle, on: bool) -> Result<(), String> {
    let login = app.autolaunch();
    let done = if on { login.enable() } else { login.disable() };
    done.map_err(|error| format!("Start at login couldn't be changed: {error}"))
}
