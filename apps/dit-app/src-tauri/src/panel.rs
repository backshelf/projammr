//! The panel: a non-activating NSPanel that floats over a full-screen DAW, takes key focus so the commit box and
//! the web's deep links can type and blur the browser, and goes away when it loses key or Esc asks (the webview's
//! `hide_panel`).
//!
//! The webview is built once at launch and stays resident, hidden, so opening it is showing a window, not loading
//! a page.

// `panel_event!` writes the `-> ()` of each handler into code of its own.
#![allow(clippy::unused_unit)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Rect, Size, WebviewUrl,
};
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
const MAX_HEIGHT: f64 = 600.0;
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
    /// Active native folder pickers opened from the panel; auto-hide is suppressed while above zero.
    picking_folder: AtomicUsize,
    /// Whether the panel should regain key focus once the outermost folder picker closes.
    restore_after_pick: AtomicBool,
}

impl PanelState {
    fn is_picking(&self) -> bool {
        self.picking_folder.load(Ordering::SeqCst) > 0
    }

    fn begin_picking(&self, restore: bool) {
        if self.picking_folder.fetch_add(1, Ordering::SeqCst) == 0 {
            self.restore_after_pick.store(restore, Ordering::SeqCst);
        }
    }

    /// Ends one folder-picker hold; returns `true` when the last hold ends and the panel should take key focus again.
    fn end_picking(&self) -> bool {
        let previous = self
            .picking_folder
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(1))
            })
            .unwrap_or(0);
        previous == 1 && self.restore_after_pick.swap(false, Ordering::SeqCst)
    }
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
    handler.window_did_resign_key(move |_| {
        if !state(&handle).is_picking() {
            hide_here(&handle);
        }
    });
    panel.set_event_handler(Some(handler.as_ref()));
    Ok(())
}

/// Emits `tauri://focus` to the panel webview so `useFocusOnShow` focuses the claimed field even though the custom
/// `NSPanel` delegate overrides Tao's default focus forwarding.
fn emit_focus(app: &AppHandle) {
    let _ = app.emit_to(LABEL, "tauri://focus", ());
}

/// Holds the panel open while a native folder picker steals key focus, then restores key focus once the picker closes.
pub fn set_picking_folder(app: &AppHandle, picking: bool) {
    let held = state(app);
    if picking {
        held.begin_picking(true);
    } else if held.end_picking() {
        on_main(app, |app| {
            if let Ok(panel) = app.get_webview_panel(LABEL) {
                panel.show_and_make_key();
                emit_focus(app);
            }
        });
    }
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
    emit_focus(app);
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

/// Sets the panel's height, keeping its top edge where it is and clamping to the monitor's working area so a tall
/// panel never clips behind the Dock.
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
        .map_or(f64::MAX, |monitor| {
            let work = monitor.work_area();
            let area = Area {
                x: f64::from(work.position.x),
                y: f64::from(work.position.y),
                w: f64::from(work.size.width),
                h: f64::from(work.size.height),
            };
            max_height(area, top.map(|position| f64::from(position.y)), scale)
        });
    let height = clamp_height(height, max);
    if let Ok(current) = window.inner_size() {
        let current_height = f64::from(current.height) / scale;
        if (current_height - height).abs() < 1.0 {
            return;
        }
    }
    let _ = window.set_size(LogicalSize::new(WIDTH, height));
    if let Some(top) = top {
        let _ = window.set_position(top);
    }
}

fn clamp_height(requested: f64, monitor_max: f64) -> f64 {
    requested.clamp(MIN_HEIGHT, monitor_max.min(MAX_HEIGHT).max(MIN_HEIGHT))
}

/// The tallest logical height the panel may take inside `work_area`, given its top edge `top_y` in physical pixels:
/// never taller than the working area and never extending past its bottom edge (the Dock).
fn max_height(work_area: Area, top_y: Option<f64>, scale: f64) -> f64 {
    let bottom = work_area.y + work_area.h;
    let available = match top_y {
        Some(y) if y >= work_area.y && y < bottom => bottom - y,
        _ => work_area.h,
    };
    (available / scale).max(MIN_HEIGHT)
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

    #[test]
    fn resize_clamps_to_the_monitors_working_area_above_the_dock() {
        // 3024x1964 Retina display with a 48px menu bar and a 160px Dock at the bottom.
        let work = Area {
            x: 0.0,
            y: 48.0,
            w: 3024.0,
            h: 1756.0,
        };
        assert_eq!(max_height(work, None, 2.0), 878.0);
        // Panel opened 8px below the menu bar stops at the Dock edge rather than clipping behind it.
        assert_eq!(max_height(work, Some(56.0), 2.0), 874.0);
        // Tiny working area still respects MIN_HEIGHT.
        let tiny = Area { h: 100.0, ..work };
        assert_eq!(max_height(tiny, Some(56.0), 2.0), MIN_HEIGHT);
        // Logical panel height never exceeds MAX_HEIGHT even on tall displays.
        assert_eq!(clamp_height(900.0, 874.0), MAX_HEIGHT);
        assert_eq!(clamp_height(900.0, 480.0), 480.0);
        assert_eq!(clamp_height(50.0, 874.0), MIN_HEIGHT);
    }

    #[test]
    fn picking_folder_suppresses_auto_hide_and_restores_once_on_close() {
        let held = PanelState::default();
        assert!(!held.is_picking());
        assert!(
            !held.end_picking(),
            "ending without a start never underflows"
        );

        held.begin_picking(true);
        assert!(held.is_picking());
        held.begin_picking(false);
        assert!(held.is_picking());
        assert!(!held.end_picking(), "inner pick closing keeps the hold");
        assert!(held.is_picking());
        assert!(held.end_picking(), "outer pick closing restores focus");
        assert!(!held.is_picking());
        assert!(!held.end_picking());
    }
}
