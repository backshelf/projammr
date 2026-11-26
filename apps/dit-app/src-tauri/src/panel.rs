//! The panel: a non-activating NSPanel that floats over a full-screen DAW, takes key focus so the commit box and
//! the web's deep links can type and blur the browser, and goes away when it loses key or Esc asks (the webview's
//! `hide_panel`).
//!
//! The webview is built once at launch and stays resident, hidden, so opening it is showing a window, not loading
//! a page.

// `panel_event!` writes the `-> ()` of each handler into code of its own.
#![allow(clippy::unused_unit)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Rect, Size, WebviewUrl};
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask, tauri_panel,
};

use crate::core::Core;

pub const LABEL: &str = "panel";

/// The panel's width and its height before the web asks for another, in logical pixels.
const WIDTH: f64 = 400.0;
const INITIAL_HEIGHT: f64 = 480.0;
/// The shortest and tallest the web may make it.
const MIN_HEIGHT: f64 = 120.0;
/// A click on the bar item takes key from the panel, and so hides it, an instant before the click arrives: a
/// click this soon after a hide is the one that hid it.
const CLICK_AFTER_HIDE: Duration = Duration::from_millis(250);

tauri_panel! {
    panel!(DitPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    panel_event!(DitPanelEvents {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

/// What the panel remembers between showings.
#[derive(Default)]
pub struct PanelState {
    /// Where the bar item was when last seen, which is where the panel opens from the shortcut or the socket.
    anchor: Mutex<Option<Rect>>,
    hidden_at: Mutex<Option<Instant>>,
}

fn state(app: &AppHandle) -> tauri::State<'_, PanelState> {
    app.state::<PanelState>()
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    app.manage(PanelState::default());
    let panel = PanelBuilder::<_, DitPanel>::new(app, LABEL)
        .url(WebviewUrl::App("index.html".into()))
        .title("dit")
        .size(Size::Logical(LogicalSize::new(WIDTH, INITIAL_HEIGHT)))
        .level(PanelLevel::Floating)
        .has_shadow(true)
        .corner_radius(12.0)
        .hides_on_deactivate(false)
        .add_style_mask(StyleMask::empty().nonactivating_panel())
        .collection_behavior(
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces(),
        )
        .with_window(|window| {
            window
                .decorations(false)
                .resizable(false)
                .visible(false)
                .skip_taskbar(true)
        })
        .build()?;

    let handler = DitPanelEvents::new();
    let handle = app.clone();
    handler.window_did_resign_key(move |_| hide_here(&handle));
    panel.set_event_handler(Some(handler.as_ref()));
    Ok(())
}

/// Runs `f` on the main thread, the only one AppKit lets touch a panel.
fn on_main(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || f(&handle));
}

/// Shows the panel under the bar item (`anchor`, or where it was last seen) with key focus.
pub fn show(app: &AppHandle, anchor: Option<Rect>) {
    on_main(app, move |app| show_here(app, anchor));
}

fn show_here(app: &AppHandle, anchor: Option<Rect>) {
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return;
    };
    let held = state(app);
    let anchor = {
        let mut last = held.anchor.lock().unwrap_or_else(|e| e.into_inner());
        if anchor.is_some() {
            *last = anchor;
        }
        *last
    };
    // Screen Recording, the login item and the `dit` link may have been changed in System Settings or a terminal
    // since the panel was last open.
    if let Some(core) = app.try_state::<Arc<Core>>() {
        core.refresh_machine();
    }
    place_under(app, anchor);
    panel.show_and_make_key();
}

pub fn hide(app: &AppHandle) {
    on_main(app, hide_here);
}

fn hide_here(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return;
    };
    if panel.is_visible() {
        *state(app)
            .hidden_at
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        panel.hide();
    }
}

/// What a click on the bar item does: hides a visible panel, else shows it, unless the click is the one that took
/// key from it.
pub fn toggle(app: &AppHandle, anchor: Option<Rect>) {
    on_main(app, move |app| toggle_here(app, anchor));
}

fn toggle_here(app: &AppHandle, anchor: Option<Rect>) {
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return;
    };
    if panel.is_visible() {
        hide_here(app);
        return;
    }
    let just_hidden = state(app)
        .hidden_at
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some_and(|at| at.elapsed() < CLICK_AFTER_HIDE);
    if !just_hidden {
        show_here(app, anchor);
    }
}

/// Sets the panel's height, keeping its top edge where it is.
pub fn resize(app: &AppHandle, height: f64) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let top = window.outer_position().ok();
    let max = window
        .current_monitor()
        .ok()
        .flatten()
        .map_or(f64::MAX, |monitor| monitor.size().height as f64 / scale);
    let height = height.clamp(MIN_HEIGHT, max.max(MIN_HEIGHT));
    let _ = window.set_size(LogicalSize::new(WIDTH, height));
    if let Some(top) = top {
        let _ = window.set_position(top);
    }
}

fn physical(position: &Position, scale: f64) -> (f64, f64) {
    match position {
        Position::Physical(p) => (f64::from(p.x), f64::from(p.y)),
        Position::Logical(p) => (p.x * scale, p.y * scale),
    }
}

fn physical_size(size: &Size, scale: f64) -> (f64, f64) {
    match size {
        Size::Physical(s) => (f64::from(s.width), f64::from(s.height)),
        Size::Logical(s) => (s.width * scale, s.height * scale),
    }
}

/// Moves the window under `anchor` on the monitor the anchor, or else the pointer, is on.
fn place_under(app: &AppHandle, anchor: Option<Rect>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let area = anchor.as_ref().map(|rect| {
        let (x, y) = physical(&rect.position, scale);
        let (w, h) = physical_size(&rect.size, scale);
        Area { x, y, w, h }
    });
    let probe = area
        .map(|area| (area.x + area.w / 2.0, area.y + area.h / 2.0))
        .or_else(|| app.cursor_position().ok().map(|p| (p.x, p.y)));
    let monitor = probe
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let bounds = Area {
        x: f64::from(monitor.position().x),
        y: f64::from(monitor.position().y),
        w: f64::from(monitor.size().width),
        h: f64::from(monitor.size().height),
    };
    let (x, y) = place(
        area,
        (f64::from(size.width), f64::from(size.height)),
        bounds,
        scale,
    );
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// A rectangle in physical screen pixels, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Where the panel's top-left corner goes: centred under `anchor` when the bar item is on `monitor` and in its
/// menu bar, else at the monitor's top-right, which is where the item lives when the menu bar is hidden over a
/// full-screen app. Always inside the monitor.
pub fn place(anchor: Option<Area>, panel: (f64, f64), monitor: Area, scale: f64) -> (f64, f64) {
    let margin = 8.0 * scale;
    let gap = 4.0 * scale;
    let menu_bar = 28.0 * scale;
    let right = monitor.x + monitor.w;
    let usable = anchor.filter(|anchor| {
        let centre = anchor.x + anchor.w / 2.0;
        anchor.h > 0.0
            && centre >= monitor.x
            && centre <= right
            && anchor.y >= monitor.y
            && anchor.y < monitor.y + 2.0 * menu_bar
    });
    let (x, y) = match usable {
        Some(anchor) => (
            anchor.x + anchor.w / 2.0 - panel.0 / 2.0,
            anchor.y + anchor.h + gap,
        ),
        None => (right - panel.0 - margin, monitor.y + menu_bar + gap),
    };
    let x = x.min(right - panel.0 - margin).max(monitor.x + margin);
    let y = y
        .min(monitor.y + monitor.h - panel.1 - margin)
        .max(monitor.y);
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area {
        x: 0.0,
        y: 0.0,
        w: 3024.0,
        h: 1964.0,
    };

    fn item(x: f64) -> Area {
        Area {
            x,
            y: 0.0,
            w: 160.0,
            h: 48.0,
        }
    }

    #[test]
    fn the_panel_opens_centred_under_the_item_a_gap_below_it() {
        let (x, y) = place(Some(item(1400.0)), (800.0, 960.0), SCREEN, 2.0);
        assert_eq!((x, y), (1480.0 - 400.0, 48.0 + 8.0));
    }

    #[test]
    fn an_item_near_the_right_edge_keeps_the_panel_on_the_screen() {
        let (x, _) = place(Some(item(2950.0)), (800.0, 960.0), SCREEN, 2.0);
        assert_eq!(x, 3024.0 - 800.0 - 16.0);
        let (x, _) = place(Some(item(0.0)), (800.0, 960.0), SCREEN, 2.0);
        assert_eq!(x, 16.0);
    }

    #[test]
    fn an_item_that_is_not_in_the_menu_bar_sends_the_panel_to_the_top_right() {
        let hidden_bar = Area {
            y: -48.0,
            ..item(1400.0)
        };
        for anchor in [
            None,
            Some(hidden_bar),
            Some(Area {
                h: 0.0,
                ..item(1400.0)
            }),
        ] {
            assert_eq!(
                place(anchor, (800.0, 960.0), SCREEN, 2.0),
                (3024.0 - 800.0 - 16.0, 56.0 + 8.0),
                "{anchor:?}"
            );
        }
    }

    #[test]
    fn an_item_on_another_monitor_is_placed_on_that_monitor() {
        let right = Area {
            x: 3024.0,
            ..SCREEN
        };
        let (x, y) = place(Some(item(3024.0 + 500.0)), (800.0, 960.0), right, 2.0);
        assert_eq!((x, y), (3024.0 + 580.0 - 400.0, 56.0));
    }

    #[test]
    fn a_tall_panel_is_held_inside_the_monitor() {
        let (_, y) = place(Some(item(1400.0)), (800.0, 1900.0), SCREEN, 2.0);
        assert_eq!(y, 1964.0 - 1900.0 - 16.0);
        let (_, y) = place(Some(item(1400.0)), (800.0, 3000.0), SCREEN, 2.0);
        assert_eq!(y, 0.0);
    }
}
