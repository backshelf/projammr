//! The global shortcut that shows the panel: the string the settings' recorder sends, made into the accelerator the
//! plugin registers, and the registration itself.

use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::panel;

/// The modifiers in the order an accelerator names them.
const ORDER: [(&str, &[&str]); 4] = [
    ("Ctrl", &["ctrl", "control"]),
    ("Alt", &["alt", "option", "opt"]),
    ("Shift", &["shift"]),
    (
        "Super",
        &[
            "super",
            "cmd",
            "command",
            "meta",
            "win",
            "mod",
            "cmdorctrl",
            "cmdorcontrol",
            "commandorctrl",
            "commandorcontrol",
        ],
    ),
];

/// The modifier `token` names, as its place in [`ORDER`].
fn modifier(token: &str) -> Option<usize> {
    let lower = token.to_ascii_lowercase();
    ORDER
        .iter()
        .position(|(_, names)| names.contains(&lower.as_str()))
}

/// Whether `key` is `F1` to `F24`: the keys that are no one's typing, so they need no modifier.
fn is_function_key(key: &str) -> bool {
    key.strip_prefix(['F', 'f'])
        .and_then(|digits| digits.parse::<u8>().ok())
        .is_some_and(|number| (1..=24).contains(&number))
}

/// The accelerator for what the recorder sent: modifiers first in the order Ctrl, Alt, Shift, Super, then the key,
/// joined with `+` (`Alt+Shift+D`). `Mod`, `Cmd` and `Command` are Super, which is Command on a Mac.
///
/// Refused, with a line the panel shows as it is: nothing to register, a sequence of keys (a chord), more than one
/// key, a key the plugin has no name for, and a key held with no Command, Control or Option, which would take that
/// key from everything typed (F1 to F24 are the exception).
pub fn accelerator(recorded: &str) -> Result<String, String> {
    let text = recorded.trim();
    if text.is_empty() {
        return Err("Press the shortcut you want.".to_string());
    }
    if text.contains(char::is_whitespace) || text.split('+').any(|t| t.len() > 1 && t.contains(','))
    {
        return Err(
            "A shortcut is one key held with modifiers, not a sequence of keys.".to_string(),
        );
    }

    let mut held = [false; 4];
    let mut keys = Vec::new();
    for token in text.split('+') {
        if token.is_empty() {
            return Err("Press the key together with the modifiers.".to_string());
        }
        match modifier(token) {
            Some(place) => held[place] = true,
            None => keys.push(token),
        }
    }
    let key = match keys.as_slice() {
        [] => return Err("Press a key together with the modifiers.".to_string()),
        [key] => *key,
        _ => return Err("A shortcut is one key held with modifiers.".to_string()),
    };
    if Shortcut::from_str(key).is_err() {
        return Err(format!("dit can't use \"{key}\" as a shortcut key."));
    }
    // Shift alone is not enough: Shift and a letter is a capital letter.
    let guards_typing = held[0] || held[1] || held[3];
    if !guards_typing && !is_function_key(key) {
        return Err(
            "Hold Command, Control or Option with the key, or it would catch your typing."
                .to_string(),
        );
    }

    let key = if key.len() == 1 || is_function_key(key) {
        key.to_ascii_uppercase()
    } else {
        key.to_string()
    };
    let mut parts: Vec<&str> = ORDER
        .iter()
        .zip(held)
        .filter_map(|((name, _), on)| on.then_some(*name))
        .collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

/// Makes `accelerator` the one key combination that shows the panel; none leaves no shortcut. A combination another
/// app holds is refused with a line saying so, and then no shortcut is registered.
pub fn register(app: &AppHandle, accelerator: Option<&str>) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts
        .unregister_all()
        .map_err(|error| format!("dit couldn't release its shortcut: {error}"))?;
    let Some(accelerator) = accelerator else {
        return Ok(());
    };
    shortcuts
        .on_shortcut(accelerator, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                panel::toggle(app, None);
            }
        })
        .map_err(|error| taken(accelerator, &error.to_string()))
}

/// The line for a combination that would not register.
fn taken(accelerator: &str, reason: &str) -> String {
    format!("{accelerator} is taken by another app ({reason}). Pick another shortcut.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(recorded: &str) -> String {
        accelerator(recorded).unwrap_or_else(|error| panic!("{recorded}: {error}"))
    }

    #[test]
    fn modifiers_come_in_a_fixed_order_whatever_order_they_were_pressed_in() {
        assert_eq!(ok("Shift+Alt+D"), "Alt+Shift+D");
        assert_eq!(
            ok("Super+Shift+Alt+Ctrl+Space"),
            "Ctrl+Alt+Shift+Super+Space"
        );
        assert_eq!(ok("Ctrl+Alt+Space"), "Ctrl+Alt+Space");
    }

    #[test]
    fn mod_cmd_and_command_are_super() {
        for spelled in ["Mod", "Cmd", "Command", "CmdOrCtrl", "Meta", "cmd"] {
            assert_eq!(ok(&format!("{spelled}+K")), "Super+K", "{spelled}");
        }
        assert_eq!(ok("Control+Option+Shift+1"), "Ctrl+Alt+Shift+1");
    }

    #[test]
    fn a_repeated_modifier_counts_once() {
        assert_eq!(ok("Alt+Alt+D"), "Alt+D");
    }

    #[test]
    fn key_names_are_the_plugins_and_a_lone_letter_is_a_capital() {
        assert_eq!(ok("alt+d"), "Alt+D");
        for key in [
            "Space",
            "Enter",
            "Tab",
            "Backspace",
            "Delete",
            "Up",
            "Down",
            "Left",
            "Right",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Comma",
            "Period",
            "Slash",
            "Backslash",
            "Semicolon",
            "Quote",
            "BracketLeft",
            "BracketRight",
            "Minus",
            "Equal",
            "Backquote",
            "F1",
            "F12",
            "F24",
            "7",
        ] {
            assert_eq!(ok(&format!("Alt+{key}")), format!("Alt+{key}"));
        }
    }

    #[test]
    fn a_bare_key_is_refused_so_typing_is_never_taken() {
        for recorded in ["D", "d", "7", "Space", "Shift+D", "Shift+7", "Shift+Space"] {
            let error = accelerator(recorded).unwrap_err();
            assert!(
                error.contains("would catch your typing"),
                "{recorded}: {error}"
            );
        }
    }

    #[test]
    fn a_function_key_needs_no_modifier() {
        assert_eq!(ok("F5"), "F5");
        assert_eq!(ok("shift+f6"), "Shift+F6");
    }

    #[test]
    fn a_chord_is_refused() {
        for recorded in ["Ctrl+K Ctrl+D", "Ctrl+K, Ctrl+D", "Ctrl+K,Ctrl+D"] {
            assert!(
                accelerator(recorded)
                    .unwrap_err()
                    .contains("sequence of keys"),
                "{recorded}"
            );
        }
    }

    #[test]
    fn two_keys_modifiers_alone_empty_and_unknown_keys_are_refused() {
        assert!(accelerator("Ctrl+K+D").unwrap_err().contains("one key"));
        assert!(accelerator("Ctrl+Alt").unwrap_err().contains("a key"));
        assert!(accelerator("").unwrap_err().contains("Press"));
        assert!(accelerator("   ").unwrap_err().contains("Press"));
        assert!(accelerator("Ctrl++D").unwrap_err().contains("together"));
        assert!(accelerator("Ctrl+Wibble").unwrap_err().contains("Wibble"));
    }

    #[test]
    fn what_it_returns_is_what_the_plugin_parses() {
        for recorded in ["Alt+Shift+D", "Mod+Space", "Ctrl+Alt+F3", "Super+Backquote"] {
            let wanted = ok(recorded);
            assert!(Shortcut::from_str(&wanted).is_ok(), "{wanted}");
        }
    }

    #[test]
    fn a_taken_combination_says_so() {
        assert!(taken("Alt+D", "x").starts_with("Alt+D is taken by another app"));
    }
}
