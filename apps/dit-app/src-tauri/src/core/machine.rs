//! What the app does with the machine it runs on: the shortcut, start at login, Screen Recording, the `dit` command,
//! waking from sleep, `projammr://` links and the artwork scheme's sign-in.

use tauri::Manager;

use super::*;

/// What a link that names no set of ours says.
const NOT_TRACKED: &str = "Not tracked by dit on this computer.";

impl Core {
    /// Takes the machine's facts into the snapshot and registers the configured shortcut. Run once, in `setup`,
    /// when the plugins are in.
    pub fn start_machine(&self) {
        let wanted = UserConfig::load(&self.paths.config)
            .ok()
            .and_then(|config| config.shortcut);
        lock(&self.host).shortcut_error = self.register_shortcut(wanted.as_deref());
        self.refresh_machine();
    }

    /// Registers `wanted` (a stored or recorded accelerator) as the panel's shortcut; the line saying why not when
    /// it would not register.
    fn register_shortcut(&self, wanted: Option<&str>) -> Option<String> {
        match wanted.map(shortcut::accelerator).transpose() {
            Ok(accelerator) => shortcut::register(&self.app, accelerator.as_deref()).err(),
            Err(why) => {
                let _ = shortcut::register(&self.app, None);
                Some(why)
            }
        }
    }

    /// Reads again what the OS holds: the login item, the `dit` link and Screen Recording.
    pub fn refresh_machine(&self) {
        let autostart = !self.paths.dev && login_item::enabled(&self.app);
        let cli_installed = cli_install::bundled()
            .ok()
            .and_then(|sidecar| cli_install::installed(Path::new(cli_install::LINK), &sidecar));
        {
            let mut host = lock(&self.host);
            host.autostart = autostart;
            host.cli_installed = cli_installed;
        }
        self.publish_settings();
        let granted = permissions::granted();
        self.with_reducer(|reducer| reducer.set_screen_recording(granted));
    }

    /// Puts the settings, as the config and the machine now say them, into the snapshot.
    pub(super) fn publish_settings(&self) {
        let config = UserConfig::load(&self.paths.config).unwrap_or_default();
        let settings = settings_of(&config, &self.home, &lock(&self.host));
        self.with_reducer(|reducer| reducer.set_settings(settings));
    }

    /// The panel's `set_setting shortcut`: a recorded accelerator, or nothing to clear it. The choice is kept in the
    /// config whether or not it registers, and a combination that would not (another app holds it) is the error, and
    /// stays in the snapshot as `shortcutError` until a shortcut registers.
    pub fn set_shortcut(&self, recorded: Option<&str>) -> Result<(), String> {
        let accelerator = match recorded.map(str::trim).filter(|text| !text.is_empty()) {
            Some(recorded) => Some(shortcut::accelerator(recorded)?),
            None => None,
        };
        self.update_config(|config| {
            config.shortcut = accelerator.clone();
            Ok(())
        })?;
        let error = self.register_shortcut(accelerator.as_deref());
        lock(&self.host).shortcut_error = error.clone();
        self.publish_settings();
        error.map_or(Ok(()), Err)
    }

    /// The panel's `set_setting autostart`. A development build never starts itself at login: it would race the
    /// installed app for the socket.
    pub fn set_autostart(&self, on: bool) -> Result<(), String> {
        if self.paths.dev {
            return Err(
                "Start at login is off in development builds, which would race the installed dit for its socket."
                    .to_string(),
            );
        }
        login_item::set(&self.app, on)?;
        self.refresh_machine();
        Ok(())
    }

    /// The panel's `set_setting machineName`: the name this machine beats to the hub as. A blank name is the
    /// computer's own. The hub is attached again with the new name when signed in.
    pub fn set_machine_name(self: &Arc<Self>, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.chars().count() > MACHINE_NAME_CHARS {
            return Err(format!(
                "A machine name is at most {MACHINE_NAME_CHARS} characters."
            ));
        }
        self.update_config(|config| {
            config.machine = (!name.is_empty()).then(|| name.to_string());
            Ok(())
        })?;
        let signed_in = lock(&self.live)
            .as_ref()
            .is_some_and(|live| live.instance.is_some());
        if signed_in {
            self.reconcile();
        }
        Ok(())
    }

    /// Asks for Screen Recording, or, once the OS has been asked and will not ask again, opens the Settings pane
    /// that holds the switch.
    pub fn request_screen_recording(&self) -> Result<(), String> {
        let asked = AppState::load(&self.paths.state).screen_recording_asked;
        permissions::request(asked)?;
        let _ = AppState::update(&self.paths.state, |state| {
            state.screen_recording_asked = true
        });
        self.refresh_machine();
        Ok(())
    }

    /// What a first signed-in run does once: start at login is switched on, Live's script is installed and Screen
    /// Recording is asked for. Each is remembered as offered whatever the answer, so a person who turns one off is not
    /// asked again.
    pub fn first_signed_in(&self) {
        let state = AppState::load(&self.paths.state);
        if !state.autostart_offered && !self.paths.dev {
            if let Err(error) = login_item::set(&self.app, true) {
                self.with_reducer(|reducer| reducer.notice(error));
            }
            let _ = AppState::update(&self.paths.state, |state| state.autostart_offered = true);
        }
        let live_found = self.script_facts().live_found;
        if let Some(installed) =
            install_script_once(self.script_kit().as_ref(), live_found, &self.paths.state)
        {
            if let Err(error) = installed {
                self.with_reducer(|reducer| reducer.notice(error));
            }
            self.refresh_script();
        }
        if !state.screen_recording_asked {
            if !permissions::granted() {
                let _ = permissions::request(false);
            }
            let _ = AppState::update(&self.paths.state, |state| {
                state.screen_recording_asked = true;
            });
        }
        self.refresh_machine();
    }

    /// The panel's `install_cli`: `dit` linked into `/usr/local/bin`, behind an administrator prompt. Never from a
    /// development build, whose binary would replace the installed app's link.
    pub fn install_cli(&self) -> Result<(), String> {
        if self.paths.dev {
            return Err(
                "The dit command is installed from the installed app, not a development build."
                    .to_string(),
            );
        }
        cli_install::install()?;
        self.refresh_machine();
        Ok(())
    }

    /// The machine woke from sleep: the daemon beats to the hub at once.
    pub fn wake(&self) {
        let _ = self.tell(|running| running.wake());
    }

    /// The panel's `allow_media`: lets the webview play `path` through the asset protocol, one file at a time.
    pub fn allow_media(&self, path: &str) -> Result<(), String> {
        let repos = RepoList::load(&self.paths.repos)
            .map(|list| list.repos)
            .unwrap_or_default();
        let file = media::playable(Path::new(path), &repos, &self.home)?;
        self.app
            .asset_protocol_scope()
            .allow_file(&file)
            .map_err(|error| error.to_string())
    }

    /// The instance's origin and the session token, for the artwork scheme's requests; `None` when signed out.
    pub fn hub_credentials(&self) -> Option<(String, String)> {
        let instance = UserConfig::load(&self.paths.config).ok()?.instance?;
        let token = self.remote.tokens().ok()?.get(&instance).ok()??;
        Some((instance.url().to_string(), token.secret().to_string()))
    }

    /// A `projammr://` link arrived. It waits for the launch catch-up when that is still running.
    pub fn link(self: &Arc<Self>, raw: &str) {
        if let Some(link) = self.links.offer(deep_link::parse(raw)) {
            self.handle_link(link);
        }
    }

    /// The daemon's launch catch-up is done: the links that waited are handled, in order, and later ones at once.
    pub(super) fn launched(self: &Arc<Self>) {
        for link in self.links.release() {
            self.handle_link(link);
        }
    }

    /// Every link shows the panel with key focus, which is what makes the browser tab that sent it blur and so
    /// count the link as answered.
    fn handle_link(self: &Arc<Self>, link: Link) {
        panel::show(&self.app, None);
        match link {
            Link::Session(id) => {
                if let Err(line) = self.open_session(id) {
                    self.with_reducer(|reducer| reducer.notice(line));
                }
            }
            Link::Checkout(commit_id) => self.begin_restore(commit_id),
            Link::Unknown(raw) => self.with_reducer(|reducer| {
                reducer.notice(format!("dit doesn't know what to do with {raw}."));
            }),
        }
    }

    /// Opens the set of hub session `id` in the DAW.
    fn open_session(&self, id: i64) -> Result<(), String> {
        let instance = UserConfig::load(&self.paths.config)
            .ok()
            .and_then(|config| config.instance)
            .ok_or(NOT_TRACKED)?;
        let repos = RepoList::load(&self.paths.repos)
            .map(|list| list.repos)
            .unwrap_or_default();
        let file = deep_link::session_file(&repos, &self.registry, instance.url(), id)
            .ok_or(NOT_TRACKED)?;
        crate::daw_app::open(&self.registry, &file)
    }

    /// "Add as version" was pressed on a render's notification: the same path the panel's `accept_render` takes. When
    /// it cannot add the render, the panel opens with the reason.
    pub fn accept_render_from_notification(&self, id: u64) {
        if let Err(error) = self.accept_render(id, None) {
            self.with_reducer(|reducer| reducer.notice(error));
            panel::show(&self.app, None);
        }
    }
}

/// The longest machine name the settings take.
const MACHINE_NAME_CHARS: usize = 64;

/// What the app does about Live's script on signed-in launch: install it once on first run with no prompt, and
/// silently refresh an already-installed script when the app ships a newer version. `None` when there is nothing to
/// do: Live is not installed (nothing remembered), the person removed the script after it was installed (stays
/// removed), or the installed script is already current.
fn install_script_once(
    kit: Option<&ScriptKit>,
    live_found: bool,
    state_path: &Path,
) -> Option<Result<usize, String>> {
    let kit = kit.filter(|_| live_found)?;
    if AppState::load(state_path).script_offered {
        let status = kit.status();
        if !status.installed || status.current {
            return None;
        }
    }
    let installed = kit.install().map_err(|error| {
        format!(
            "dit couldn't install Live's script in {}: {error}",
            kit.folder.display()
        )
    });
    let _ = AppState::update(state_path, |state| state.script_offered = true);
    Some(installed)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn kit(folder: PathBuf) -> ScriptKit {
        ScriptKit {
            folder,
            files: &[("__init__.py", "print('dit')")],
            version: "1",
        }
    }

    #[test]
    fn the_script_is_installed_on_the_first_run_and_not_again() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("app-state.json");
        let kit = kit(dir.path().join("Remote Scripts").join("dit"));

        let first = install_script_once(Some(&kit), true, &state);

        assert!(matches!(first, Some(Ok(written)) if written > 0));
        assert!(kit.status().installed);
        assert!(AppState::load(&state).script_offered);

        fs::remove_dir_all(&kit.folder).unwrap();
        assert!(install_script_once(Some(&kit), true, &state).is_none());
        assert!(
            !kit.folder.exists(),
            "a script the person removed stays removed"
        );
    }

    #[test]
    fn an_installed_older_script_is_upgraded_on_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("app-state.json");
        let folder = dir.path().join("Remote Scripts").join("dit");
        let v1 = kit(folder.clone());
        assert!(matches!(
            install_script_once(Some(&v1), true, &state),
            Some(Ok(w)) if w > 0
        ));

        let v2 = ScriptKit {
            folder,
            files: &[("__init__.py", "print('dit v2')")],
            version: "2",
        };
        assert!(matches!(
            install_script_once(Some(&v2), true, &state),
            Some(Ok(w)) if w > 0
        ));
        assert!(v2.status().current);
        assert!(install_script_once(Some(&v2), true, &state).is_none());
    }

    #[test]
    fn with_no_live_nothing_is_installed_or_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("app-state.json");
        let kit = kit(dir.path().join("Remote Scripts").join("dit"));

        assert!(install_script_once(Some(&kit), false, &state).is_none());
        assert!(install_script_once(None, true, &state).is_none());

        assert!(!kit.folder.exists());
        assert!(!AppState::load(&state).script_offered);
        assert!(install_script_once(Some(&kit), true, &state).is_some());
    }

    #[test]
    fn a_failed_install_is_a_line_for_the_panel_and_is_not_tried_again() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("app-state.json");
        let blocked = dir.path().join("Remote Scripts");
        fs::write(&blocked, "a file where the folder should go").unwrap();
        let kit = kit(blocked.join("dit"));

        let outcome = install_script_once(Some(&kit), true, &state);

        let Some(Err(line)) = outcome else {
            panic!("the install fails")
        };
        assert!(
            line.starts_with("dit couldn't install Live's script in "),
            "{line}"
        );
        assert!(AppState::load(&state).script_offered);
        assert!(install_script_once(Some(&kit), true, &state).is_none());
    }
}
