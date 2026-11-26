//! The one notification dit sends: a render found, with an "Add as version" action. The action is routed to the same
//! code the panel's `accept_render` command runs, and a click on the notification itself shows the panel.
//!
//! Notification actions are reported to a running, bundled app only: under `tauri dev` macOS attributes the
//! notification to Terminal, so the action never arrives (see `apps/dit-app/CLAUDE.md`).

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::{Action, ActionType, NotificationExt};

use crate::core::Core;
use crate::panel;

/// The action type a render's notification references.
const ACTION_TYPE: &str = "render";
/// The action's identifier and its title. macOS reports an action by its title, so both name it.
const ADD_ID: &str = "add";
const ADD_TITLE: &str = "Add as version";
/// The key under which the notification carries the render's id.
const RENDER_KEY: &str = "render";

/// What the person did with the notification.
#[derive(Debug, PartialEq, Eq)]
enum Reaction {
    /// Pressed "Add as version".
    Add,
    /// Clicked the notification itself.
    Open,
}

fn reaction(action_id: &str) -> Reaction {
    if action_id == ADD_ID || action_id == ADD_TITLE {
        Reaction::Add
    } else {
        Reaction::Open
    }
}

/// The render id a notification carries in its extras: the ledger's number, which the notification holds as text.
fn render_id(extra: &std::collections::HashMap<String, Value>) -> Option<u64> {
    match extra.get(RENDER_KEY)? {
        Value::String(text) => text.parse().ok(),
        other => other.as_u64(),
    }
}

/// Registers the action type and starts listening to what is done with the app's notifications.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let notifications = app.notification();
    notifications
        .register_action_types(vec![
            ActionType::builder(ACTION_TYPE)
                .actions(vec![Action::builder(ADD_ID, ADD_TITLE).build()])
                .build(),
        ])
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    notifications
        .on_action(move |performed| match reaction(performed.action_id()) {
            Reaction::Add => {
                let id = performed
                    .notification()
                    .and_then(|notification| render_id(notification.extra()));
                if let (Some(core), Some(id)) = (handle.try_state::<Arc<Core>>(), id) {
                    core.accept_render_from_notification(id);
                }
            }
            Reaction::Open => panel::show(&handle, None),
        })
        .map_err(|error| error.to_string())
}

/// Tells the person a render is ready to be added as a version, with the action that adds it; `id` comes back when
/// the action is pressed.
pub fn notify_render(app: &AppHandle, id: u64, title: &str, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .action_type_id(ACTION_TYPE)
        .extra(RENDER_KEY, id.to_string())
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    #[test]
    fn the_action_is_known_by_its_id_and_by_its_title() {
        assert_eq!(reaction("add"), Reaction::Add);
        assert_eq!(reaction("Add as version"), Reaction::Add);
    }

    #[test]
    fn a_click_on_the_notification_or_anything_else_opens_the_panel() {
        assert_eq!(reaction("tap"), Reaction::Open);
        assert_eq!(reaction("dismiss"), Reaction::Open);
        assert_eq!(reaction(""), Reaction::Open);
    }

    #[test]
    fn the_render_id_comes_back_from_the_extras() {
        let mut extra = HashMap::new();
        assert_eq!(render_id(&extra), None);
        extra.insert("render".to_string(), json!("41"));
        assert_eq!(render_id(&extra), Some(41));
        extra.insert("render".to_string(), json!(7));
        assert_eq!(render_id(&extra), Some(7));
        extra.insert("render".to_string(), json!("r-41"));
        assert_eq!(render_id(&extra), None, "an id is a number");
        extra.insert("render".to_string(), json!(-1));
        assert_eq!(render_id(&extra), None);
    }
}
