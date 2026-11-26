//! The backfill window: an ordinary resizable window beside the panel, one at a time. The panel is one 400 px screen at
//! a time; the batch lists hundreds of sets.
//!
//! The webview holds nothing worth keeping: the run, the folders found and what Check read live in the core, so a
//! window closed on Bring in only pauses the run, and the next one shows it.

use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::core::Core;

pub const LABEL: &str = "backfill";

const TITLE: &str = "Bring in projects";

/// Opens the window, or brings the one that is open forward.
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("backfill.html".into()))
        .title(TITLE)
        .inner_size(1040.0, 700.0)
        .min_inner_size(800.0, 520.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed)
            && let Some(core) = handle.try_state::<Arc<Core>>()
        {
            core.backfill_closed();
        }
    });
    // The panel hides itself when the window takes key from it.
    window.set_focus().map_err(|error| error.to_string())
}

/// Closes the window if it is open, which `Destroyed` follows; whether there was one to close.
pub fn close(app: &AppHandle) -> bool {
    match app.get_webview_window(LABEL) {
        Some(window) => {
            let _ = window.close();
            true
        }
        None => false,
    }
}
