//! Creating and finding the `.dit/` folder.

use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::lock::{LOCK_TIMEOUT, acquire};
use super::refs::{atomic_write, write_sets};
use super::{Repo, RepoError, io_error};
use crate::daw::{Daw, Registry};
use crate::store::Store;

pub(super) const DIT_DIR: &str = ".dit";
pub(super) const CONFIG_FILE: &str = "config.toml";
pub(super) const OBJECTS_DIR: &str = "objects";
pub(super) const LOGS_DIR: &str = "logs";
pub(super) const REFS_DIR: &str = "refs/sets";
pub(super) const PUSHED_DIR: &str = "refs/remote";

#[derive(Serialize, Deserialize)]
struct Config {
    daw: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote: Option<RemoteBinding>,
    /// The hub's answer about pushing samples, as the last push or `dit config push-samples` heard it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    push_samples: Option<PushSamples>,
}

/// Whether the bound hub repo takes this repo's sample objects: `[push_samples]` in `.dit/config.toml`, a cache of
/// the hub's setting that every push and `dit config push-samples` rewrites. Kept beside `[remote]`, never in it:
/// `rebind_remote` compares bindings by equality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushSamples {
    /// The repo's own switch.
    pub enabled: bool,
    /// The instance pushes samples for every repo, whatever the switch says.
    pub forced: bool,
}

impl PushSamples {
    /// Whether a push sends sample objects.
    pub fn pushing(&self) -> bool {
        self.enabled || self.forced
    }
}

/// The hub repo this repo pushes to: `[remote]` in `.dit/config.toml`, written by the first push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteBinding {
    /// The instance's origin, as `Instance::url` gives it.
    pub instance: String,
    /// The repo's id on that instance.
    pub repo: i64,
}

impl Repo {
    /// Creates `.dit/` in `dir`, which the DAW must recognise as a project
    /// folder. Files already in `.dit/` are left as they are.
    pub fn init(dir: &Path, daw: &'static dyn Daw) -> Result<Repo, RepoError> {
        Self::init_waiting(dir, daw, LOCK_TIMEOUT)
    }

    /// `init` whose writers, its own included, wait `lock_wait` for the lock.
    pub(super) fn init_waiting(
        dir: &Path,
        daw: &'static dyn Daw,
        lock_wait: Duration,
    ) -> Result<Repo, RepoError> {
        if !daw.is_project_folder(dir) {
            return Err(RepoError::NotAProject(dir.to_path_buf()));
        }
        let root = dir.canonicalize().map_err(io_error)?;
        let dit = root.join(DIT_DIR);
        for sub in [OBJECTS_DIR, LOGS_DIR, REFS_DIR] {
            fs::create_dir_all(dit.join(sub)).map_err(io_error)?;
        }
        let _lock = acquire(&dit, lock_wait)?;
        if !dit.join(super::refs::SETS_FILE).exists() {
            write_sets(&dit, &Default::default())?;
        }
        if !dit.join(CONFIG_FILE).exists() {
            write_config(
                &dit,
                &Config {
                    daw: daw.id().to_string(),
                    remote: None,
                    push_samples: None,
                },
            )?;
        }
        Ok(Repo {
            store: Store::open(dit.join(OBJECTS_DIR))?,
            root,
            daw,
            lock_wait,
            machine: Repo::default_machine(),
        })
    }

    /// Opens the repo whose `.dit/` is in `path` or its parent, resolving the
    /// DAW named in `config.toml` through `registry`.
    pub fn open(path: &Path, registry: &Registry) -> Result<Repo, RepoError> {
        let not_a_repo = || RepoError::NotARepo(path.to_path_buf());
        let start = path.canonicalize().map_err(|_| not_a_repo())?;
        let root = [Some(start.as_path()), start.parent()]
            .into_iter()
            .flatten()
            .find(|dir| dir.join(DIT_DIR).is_dir())
            .ok_or_else(not_a_repo)?
            .to_path_buf();
        let dit = root.join(DIT_DIR);
        let config = read_config(&dit)?;
        let daw = registry
            .by_id(&config.daw)
            .ok_or(RepoError::UnknownDaw(config.daw))?;
        Ok(Repo {
            store: Store::open(dit.join(OBJECTS_DIR))?,
            root,
            daw,
            lock_wait: LOCK_TIMEOUT,
            machine: Repo::default_machine(),
        })
    }

    pub(super) fn dit_dir(&self) -> std::path::PathBuf {
        self.root.join(DIT_DIR)
    }

    /// The hub repo this repo pushes to, if a push has bound it.
    pub fn remote_binding(&self) -> Result<Option<RemoteBinding>, RepoError> {
        Ok(read_config(&self.dit_dir())?.remote)
    }

    /// The hub's push-samples setting as it was last heard, `None` before any push or `dit config push-samples`.
    pub fn push_samples(&self) -> Result<Option<PushSamples>, RepoError> {
        Ok(read_config(&self.dit_dir())?.push_samples)
    }

    /// Caches the hub's push-samples setting in `config.toml`, keeping the rest of the file; a cache that already
    /// says it is not rewritten.
    pub fn cache_push_samples(&self, state: PushSamples) -> Result<(), RepoError> {
        let _lock = self.lock()?;
        let dit = self.dit_dir();
        let config = read_config(&dit)?;
        if config.push_samples == Some(state) {
            return Ok(());
        }
        write_config(
            &dit,
            &Config {
                push_samples: Some(state),
                ..config
            },
        )
    }

    /// Records the hub repo this repo pushes to in `config.toml`, keeping the rest of the file.
    pub fn bind_remote(&self, binding: &RemoteBinding) -> Result<(), RepoError> {
        let _lock = self.lock()?;
        let dit = self.dit_dir();
        let config = Config {
            remote: Some(binding.clone()),
            ..read_config(&dit)?
        };
        write_config(&dit, &config)
    }

    /// Moves the binding `from` to the instance origin `instance`, keeping its hub repo, under one hold of the lock:
    /// first every set file pushes recorded for `from` gets `instance`, then `[remote]` in `config.toml` does.
    /// Returns how many set files it rewrote. A config bound to anything but `from` is refused with nothing written.
    ///
    /// The config goes last, so a run that stops partway is repaired by running it again: the config still names
    /// `from`, the files left behind are rewritten, and the files already moved carry `instance` and need no write.
    pub fn rebind_remote(&self, from: &RemoteBinding, instance: &str) -> Result<usize, RepoError> {
        let _lock = self.lock()?;
        let dit = self.dit_dir();
        let config = read_config(&dit)?;
        if config.remote.as_ref() != Some(from) {
            return Err(RepoError::RemoteChanged);
        }
        let rewritten = self.repoint_pushed_unlocked(from, instance)?;
        let config = Config {
            remote: Some(RemoteBinding {
                instance: instance.to_string(),
                repo: from.repo,
            }),
            ..config
        };
        write_config(&dit, &config)?;
        Ok(rewritten)
    }
}

fn read_config(dit: &Path) -> Result<Config, RepoError> {
    let text = fs::read_to_string(dit.join(CONFIG_FILE)).map_err(io_error)?;
    toml::from_str(&text).map_err(|e| RepoError::Io(format!("{CONFIG_FILE}: {e}")))
}

fn write_config(dit: &Path, config: &Config) -> Result<(), RepoError> {
    let text = toml::to_string(config).map_err(|e| RepoError::Io(format!("{CONFIG_FILE}: {e}")))?;
    atomic_write(&dit.join(CONFIG_FILE), text.as_bytes())
}
