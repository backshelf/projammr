//! Where the app keeps its files. A release app shares the cli's: the user config, `repos.toml` and the socket sit in
//! `dit/` beside each other, which is how `dit` finds a running app. A development app (an identifier ending `.dev`)
//! keeps all three in a folder named for its identifier, so it never takes the installed app's socket or touches its
//! repo list.

use std::path::PathBuf;

use dit_core::RepoList;
use dit_core::remote::UserConfig;

/// The file the app's own first-run memory is kept in, beside the user config.
const STATE_FILE: &str = "app-state.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub config: PathBuf,
    pub repos: PathBuf,
    /// What the app remembers of its own first runs (`state::AppState`).
    pub state: PathBuf,
    pub socket: PathBuf,
    /// A development identity: nothing here may take over what an installed app owns.
    pub dev: bool,
}

impl Paths {
    pub fn resolve(identifier: &str) -> Result<Paths, String> {
        if identifier.ends_with(".dev") {
            let dir = dirs::config_dir()
                .ok_or("This system has no user config folder.")?
                .join(identifier);
            return Ok(Paths::in_folder(dir, true));
        }
        let message = |error: dit_core::remote::RemoteError| error.to_string();
        let config = UserConfig::default_path().map_err(message)?;
        Ok(Paths {
            state: config.with_file_name(STATE_FILE),
            config,
            repos: RepoList::default_path().map_err(message)?,
            socket: dit_ipc::default_path().ok_or("This system has no user config folder.")?,
            dev: false,
        })
    }

    fn in_folder(dir: PathBuf, dev: bool) -> Paths {
        Paths {
            config: dir.join("config.toml"),
            repos: dir.join("repos.toml"),
            state: dir.join(STATE_FILE),
            socket: dir.join("dit.sock"),
            dev,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_release_identity_shares_the_clis_files() {
        let paths = Paths::resolve("app.projammr.dit").unwrap();
        assert_eq!(paths.config, UserConfig::default_path().unwrap());
        assert_eq!(paths.repos, RepoList::default_path().unwrap());
        assert_eq!(Some(paths.socket), dit_ipc::default_path());
        assert!(!paths.dev);
    }

    #[test]
    fn a_dev_identity_keeps_everything_in_a_folder_of_its_own() {
        let paths = Paths::resolve("app.projammr.dit.dev").unwrap();
        let release = Paths::resolve("app.projammr.dit").unwrap();
        assert!(paths.dev);
        for (dev, shared) in [
            (&paths.config, &release.config),
            (&paths.repos, &release.repos),
            (&paths.socket, &release.socket),
        ] {
            assert_ne!(dev, shared);
            assert!(dev.to_string_lossy().contains("app.projammr.dit.dev"));
        }
    }
}
