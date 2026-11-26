//! The bar item: the template icon (or, while a push is going, the progress arc), its title and its accessibility
//! label, and the click that toggles the panel.

use objc2::MainThreadMarker;
use objc2_app_kit::NSAccessibility;
use objc2_foundation::NSString;
use tauri::AppHandle;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::arc;
use crate::panel;
use crate::snapshot::Snapshot;

const TRAY_ID: &str = "dit";

/// The dit icon, a template image so the bar tints it.
fn base_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))
}

/// What the bar's icon shows: the dit icon, or the progress arc at one of its steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Face {
    Icon,
    Arc(usize),
}

impl Face {
    /// The face for a snapshot: the arc while a push has progress to show.
    fn of(snapshot: &Snapshot) -> Face {
        snapshot.push.progress.map_or(Face::Icon, |progress| {
            Face::Arc(arc::step(progress.done, progress.total))
        })
    }
}

/// The bar item, with what was last given it, so an unchanged one is not set again, and the images it swaps between.
pub struct Shown {
    title: Option<String>,
    label: Option<String>,
    face: Face,
    icon: Option<Image<'static>>,
    /// `arcs[step - 1]` is the image for `step`.
    arcs: Vec<Image<'static>>,
}

impl Default for Shown {
    fn default() -> Self {
        Shown {
            title: None,
            label: None,
            face: Face::Icon,
            icon: base_icon().ok(),
            arcs: (1..=arc::STEPS)
                .map(|step| Image::new_owned(arc::frame(step), arc::SIZE as u32, arc::SIZE as u32))
                .collect(),
        }
    }
}

impl Shown {
    pub fn show(&mut self, app: &AppHandle, snapshot: &Snapshot) {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return;
        };
        let (title, label) = (snapshot.title(), snapshot.label());
        if self.title.as_ref() != Some(&title) {
            // No title leaves the icon alone.
            let _ = tray.set_title((!title.is_empty()).then_some(&title));
            self.title = Some(title);
        }
        if self.label.as_ref() != Some(&label) {
            label_item(&tray, &label);
            self.label = Some(label);
        }
        let face = Face::of(snapshot);
        if self.face != face {
            let image = match face {
                Face::Icon => self.icon.clone(),
                Face::Arc(step) => self.arcs.get(step - 1).cloned(),
            };
            if let Some(image) = image {
                let _ = tray.set_icon(Some(image));
                let _ = tray.set_icon_as_template(true);
                self.face = face;
            }
        }
    }
}

/// Gives the status item's button an accessibility label that reads the title in words.
fn label_item(tray: &TrayIcon, label: &str) {
    let label = label.to_string();
    let _ = tray.with_inner_tray_icon(move |inner| {
        let (Some(item), Some(main)) = (inner.ns_status_item(), MainThreadMarker::new()) else {
            return;
        };
        if let Some(button) = item.button(main) {
            button.setAccessibilityLabel(Some(&NSString::from_str(&label)));
        }
    });
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(base_icon()?)
        .icon_as_template(true)
        .tooltip("dit")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                panel::toggle(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}
