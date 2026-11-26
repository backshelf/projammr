//! Screen Recording, which macOS requires before another app's window titles are readable: dit reads Live's window
//! title to know which set is open.

use std::process::Command;

use core_graphics::access::ScreenCaptureAccess;

/// Where System Settings lists the apps with Screen Recording.
const SETTINGS_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/// Whether the permission is granted, without asking.
pub fn granted() -> bool {
    ScreenCaptureAccess.preflight()
}

/// Asks for the permission. macOS shows its own prompt the first time and never again, so once the app has asked
/// (`asked`) the answer is to take the person to System Settings, where the switch is. Returns whether it is granted.
pub fn request(asked: bool) -> Result<bool, String> {
    if granted() {
        return Ok(true);
    }
    if asked {
        let status = Command::new("open")
            .arg(SETTINGS_PANE)
            .status()
            .map_err(|error| format!("Couldn't open System Settings: {error}"))?;
        if !status.success() {
            return Err(format!("Couldn't open System Settings: open {status}"));
        }
        return Ok(false);
    }
    Ok(ScreenCaptureAccess.request())
}
