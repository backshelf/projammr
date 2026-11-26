//! The commands the panel invokes (`Commands` in `src/ipc.ts`). Each does its work through the daemon, the cli's
//! library or `dit-core`, and answers nothing or the one line the panel shows under the control that sent it.

use std::path::PathBuf;
use std::sync::Arc;

use dit_cli::Env;
use dit_core::remote::UserConfig;
use dit_daemon::event::Input;
use dit_ipc::Run;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::backfill::{Target, View};
use crate::core::{Core, Rejection, check_roots, open_url};
use crate::snapshot::Snapshot;
use crate::update::Updates;
use crate::{panel, restore};

type Answer = Result<(), String>;
type Shared<'a> = State<'a, Arc<Core>>;

#[tauri::command]
pub fn get_snapshot(core: Shared) -> Snapshot {
    core.snapshot()
}

#[tauri::command(async)]
pub fn sign_in(core: Shared, host: Option<String>) -> Answer {
    core.inner().sign_in(host)
}

#[tauri::command(async)]
pub fn sign_out(core: Shared) -> Answer {
    core.inner().sign_out()
}

#[tauri::command(async)]
pub fn adopt(core: Shared, folder: String, project_id: Option<i64>) -> Answer {
    core.inner().adopt(PathBuf::from(folder), project_id)
}

#[tauri::command(async)]
pub fn decline_folder(core: Shared, folder: String) -> Answer {
    let folder = PathBuf::from(folder);
    let declined = folder.clone();
    core.tell(move |running| running.send(Input::Decline(declined)))?;
    core.with_reducer(|reducer| reducer.clear_adopt_offer(&folder));
    Ok(())
}

/// The menu's "Track a folder…": the adopt offer for the folder the panel's picker chose.
#[tauri::command(async)]
pub fn track_folder(core: Shared, folder: String) -> Answer {
    core.inner().track_folder(PathBuf::from(folder))
}

/// `set` is the set file's path, as the snapshot's `open.path` gives it.
#[tauri::command(async)]
pub fn commit(core: Shared, set: String, message: String) -> Answer {
    core.commit(&set, &message)
}

#[tauri::command]
pub fn set_draft(core: Shared, set: String, message: String) {
    core.set_draft(set, message);
}

/// Sets one of the settings. The ones the config holds go through [`apply_setting`]; the shortcut, start at login
/// and the machine's name each have a side effect of their own.
#[tauri::command(async)]
pub fn set_setting(core: Shared, key: String, value: Value) -> Answer {
    let core = core.inner();
    match key.as_str() {
        "shortcut" => {
            let shortcut = typed::<Option<String>>(&key, value, "text or nothing")?;
            Ok(core.set_shortcut(shortcut.as_deref())?)
        }
        "autostart" => Ok(core.set_autostart(typed(&key, value, "on or off")?)?),
        "machineName" => Ok(core.set_machine_name(&typed::<String>(&key, value, "text")?)?),
        _ => {
            core.update_config(|config| {
                *config = apply_setting(config, &key, value)?;
                Ok(())
            })?;
            Ok(core.render_setting_changed(&key)?)
        }
    }
}

/// `value` as the kind of thing setting `key` takes, or the line saying what it needs.
fn typed<T: DeserializeOwned>(key: &str, value: Value, what: &str) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| format!("`{key}` needs {what}."))
}

/// `config` with the setting `key` given `value`.
fn apply_setting(config: &UserConfig, key: &str, value: Value) -> Result<UserConfig, String> {
    let mut config = config.clone();
    match key {
        "maxUploadMb" => {
            config.max_upload_mb = Some(typed(key, value, "a whole number of megabytes")?);
        }
        "watchRoots" => {
            let roots: Vec<String> = typed(key, value, "a list of folders")?;
            check_roots(&roots)?;
            config.watch_roots = roots;
        }
        "excluded" => config.excluded = typed(key, value, "a list of folders")?,
        other => return Err(format!("There is no setting called `{other}`.")),
    }
    Ok(config)
}

#[tauri::command(async)]
pub fn open_web(core: Shared, path: Option<String>) -> Answer {
    let url = core.web_url(path.as_deref())?;
    open_url(&url)
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    panel::hide(&app);
}

#[tauri::command]
pub fn resize_panel(app: AppHandle, height: f64) {
    panel::resize(&app, height);
}

/// Writes the Live script where Live looks for it, as `dit script install` does.
#[tauri::command(async)]
pub fn install_script(core: Shared) -> Answer {
    let run = Run {
        cwd: dirs::home_dir().unwrap_or_default(),
        env: Env::from_process(),
        argv: vec!["script".to_string(), "install".to_string()],
    };
    let mut stderr = Vec::new();
    let done = dit_cli::handle(run, &mut stderr, &core.remote, None, None);
    core.refresh_script();
    match done.code {
        0 => Ok(()),
        _ => Err(done
            .refusal
            .unwrap_or_else(|| String::from_utf8_lossy(&stderr).trim().to_string())),
    }
}

/// "Update to <version>": takes the release the menu offers. Answers once the work has started; the snapshot's
/// `update` follows it to the relaunch or to its failure.
#[tauri::command]
pub fn install_update(app: AppHandle) -> Answer {
    let updates = app
        .try_state::<Arc<Updates>>()
        .ok_or("This build doesn't update itself.")?;
    updates.install().map(|_| ())
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// Links the `dit` command into `/usr/local/bin`, asking for an administrator's password.
#[tauri::command(async)]
pub fn install_cli(core: Shared) -> Answer {
    core.install_cli()
}

/// Asks for Screen Recording, or opens the Settings pane for it once macOS has been asked.
#[tauri::command(async)]
pub fn request_screen_recording(core: Shared) -> Answer {
    core.request_screen_recording()
}

/// Lets the webview play the audio file at `path` through the asset protocol.
#[tauri::command]
pub fn allow_media(core: Shared, path: String) -> Answer {
    core.allow_media(&path)
}

/// Lets go of the restore link the panel was showing.
#[tauri::command]
pub fn cancel_restore(core: Shared) {
    core.cancel_restore();
}

/// Links the hub session of the open set `set` to the track `track`: a choice's id from the proposal, or `new`.
#[tauri::command(async)]
pub fn propose_track(core: Shared, set: String, track: String) -> Answer {
    core.inner().propose_track(&set, &track)
}

/// Adds the render `id` as a version of its set's track: of the set whose hub session is `session` when the card's
/// "Not this set" picker chose another. The upload goes on in the background and shows in the card; this is also what
/// the notification's "Add as version" runs.
#[tauri::command(async)]
pub fn accept_render(core: Shared, id: u64, session: Option<i64>) -> Answer {
    core.accept_render(id, session)
}

/// Turns the render `id` down: "Not a bounce" or "Never here".
#[tauri::command(async)]
pub fn reject_render(core: Shared, id: u64, mode: Rejection) -> Answer {
    core.reject_render(id, mode)
}

/// Restores the hub commit `commit_id` as the new branch `name` and opens the file in the DAW. Progress and the end
/// are in the snapshot's `restore`.
#[tauri::command(async)]
pub fn restore(core: Shared, commit_id: i64, name: String) -> Answer {
    core.inner().restore(commit_id, &name)
}

/// The core's refusal of the branch name `name`, for the restore screen's field; nothing for a name it takes.
#[tauri::command]
pub fn validate_branch_name(name: String) -> Answer {
    restore::check_branch_name(&name)
}

/// Settings: a file marked "Not a bounce" may be proposed again.
#[tauri::command(async)]
pub fn forget_rejection(core: Shared, fingerprint: String) -> Answer {
    core.forget_rejection(&fingerprint)
}

/// Settings: a folder marked "Never here" is looked in again.
#[tauri::command(async)]
pub fn forget_never_here(core: Shared, folder: String) -> Answer {
    core.inner().forget_never_here(&folder)
}

/// The panel's "Bring in projects…": opens the backfill window, or brings it forward, on the run there is.
#[tauri::command(async)]
pub fn open_backfill(core: Shared) -> Answer {
    core.open_backfill()
}

#[tauri::command(async)]
pub fn get_backfill(core: Shared) -> View {
    core.backfill_view()
}

/// Replaces the roots Find searches under, and searches again.
#[tauri::command(async)]
pub fn backfill_roots(core: Shared, roots: Vec<String>) -> Answer {
    core.backfill.set_roots(roots)
}

/// Searches the roots again.
#[tauri::command(async)]
pub fn backfill_find(core: Shared) -> Answer {
    core.backfill.find()
}

/// Shows the sets of `folder` on the window's right.
#[tauri::command(async)]
pub fn backfill_choose(core: Shared, folder: String) -> Answer {
    core.backfill.choose(&folder)
}

/// Next: reads the ticked folders and asks the hub; also "Try again" for a hub that did not answer.
#[tauri::command(async)]
pub fn backfill_check(core: Shared, folders: Vec<String>) -> Answer {
    core.backfill.check(folders)
}

/// Changes where one set of a checked folder goes.
#[tauri::command(async)]
pub fn backfill_set_target(core: Shared, folder: String, file: String, target: Target) -> Answer {
    core.backfill.set_target(&folder, &file, &target)
}

/// Moves a checked folder into another project.
#[tauri::command(async)]
pub fn backfill_set_project(core: Shared, folder: String, project: i64) -> Answer {
    core.backfill.set_project(&folder, project)
}

/// Back: from Check to Find, removing what Check made.
#[tauri::command(async)]
pub fn backfill_back(core: Shared) -> Answer {
    core.backfill.back()
}

/// Start: brings the checked folders in.
#[tauri::command(async)]
pub fn backfill_start(core: Shared) -> Answer {
    core.backfill.begin()
}

#[tauri::command]
pub fn backfill_pause(core: Shared) {
    core.pause_backfill();
}

/// Carries on the stopped run where it was.
#[tauri::command(async)]
pub fn backfill_resume(core: Shared) -> Answer {
    core.backfill.resume()
}

/// Try again for a failed folder.
#[tauri::command(async)]
pub fn backfill_retry(core: Shared, folder: String) -> Answer {
    core.backfill.retry(&folder)
}

/// Closes the backfill window, which is what its red button does; the JS window API is not granted to it.
#[tauri::command(async)]
pub fn backfill_close(core: Shared) {
    core.close_backfill();
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn each_config_setting_takes_its_own_kind_of_value() {
        let start = UserConfig::default();
        let set = |key, value| apply_setting(&start, key, value);

        assert_eq!(
            set("maxUploadMb", json!(25)).unwrap().max_upload_mb,
            Some(25)
        );
        let folder = tempfile::tempdir().unwrap();
        let (a, b) = (folder.path().join("a"), folder.path().join("b"));
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let roots = [a.display().to_string(), b.display().to_string()];
        assert_eq!(set("watchRoots", json!(roots)).unwrap().watch_roots, roots);
        assert_eq!(set("excluded", json!(["/c"])).unwrap().excluded, ["/c"]);
    }

    #[test]
    fn a_wrong_value_or_an_unknown_key_is_refused_and_changes_nothing() {
        let start = UserConfig::default();
        for (key, value) in [
            ("maxUploadMb", json!(-1)),
            ("maxUploadMb", json!("big")),
            ("watchRoots", json!("/a")),
            ("excluded", json!([1])),
            ("colour", json!("red")),
            // These have a home of their own, which is not the config's.
            ("shortcut", json!("Alt+D")),
            ("autostart", json!(true)),
            ("machineName", json!("Studio")),
            ("cliInstalled", json!("/usr/local/bin/dit")),
            ("shortcutError", json!(null)),
        ] {
            assert!(
                apply_setting(&start, key, value.clone()).is_err(),
                "{key} {value}"
            );
        }
    }

    #[test]
    fn a_setting_that_goes_to_the_machine_is_read_as_its_kind_or_refused() {
        assert_eq!(
            typed::<Option<String>>("shortcut", json!("Alt+D"), "text or nothing").unwrap(),
            Some("Alt+D".to_string())
        );
        assert_eq!(
            typed::<Option<String>>("shortcut", json!(null), "text or nothing").unwrap(),
            None
        );
        assert_eq!(
            typed::<Option<String>>("shortcut", json!(4), "text or nothing").unwrap_err(),
            "`shortcut` needs text or nothing."
        );
        assert!(typed::<bool>("autostart", json!(true), "on or off").unwrap());
        assert_eq!(
            typed::<bool>("autostart", json!("yes"), "on or off").unwrap_err(),
            "`autostart` needs on or off."
        );
        assert_eq!(
            typed::<String>("machineName", json!(null), "text").unwrap_err(),
            "`machineName` needs text."
        );
    }

    #[test]
    fn a_setting_leaves_the_rest_of_the_config_as_it_was() {
        let start = UserConfig {
            machine: Some("Studio".into()),
            shortcut: Some("Alt+D".into()),
            ..UserConfig::default()
        };
        let changed = apply_setting(&start, "excluded", json!(["/x"])).unwrap();
        assert_eq!(changed.machine.as_deref(), Some("Studio"));
        assert_eq!(changed.shortcut.as_deref(), Some("Alt+D"));
    }

    #[test]
    fn watch_roots_that_are_not_folders_are_refused_and_change_nothing() {
        let start = UserConfig::default();
        let error =
            apply_setting(&start, "watchRoots", json!(["/no/such/folder/here"])).unwrap_err();
        assert_eq!(error, "/no/such/folder/here isn't a folder dit can watch.");
    }

    #[test]
    fn the_panels_words_for_a_turn_down_and_a_branch_are_read_by_the_commands() {
        assert_eq!(
            serde_json::from_value::<Rejection>(json!("never-here")).unwrap(),
            Rejection::NeverHere
        );
        assert_eq!(validate_branch_name("restore-a1b2c3d".to_string()), Ok(()));
        assert_eq!(
            validate_branch_name("a/b".to_string()).unwrap_err(),
            "`a/b` is not a usable branch name"
        );
    }
}
