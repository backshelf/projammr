//! Signing a machine in to a Projammr instance and talking to it as that machine: the user config naming the
//! instance and the machine, the HTTP client, the token store and the device grant.
//!
//! A sign-in holds a session token and never a password. The token lives in the token store alone: it never reaches
//! the user config, an error message or any output.

#[cfg(feature = "store")]
mod adopt;
#[cfg(all(test, feature = "store"))]
mod adopt_tests;
mod auth;
mod client;
#[cfg(feature = "store")]
mod hub;
#[cfg(target_vendor = "apple")]
mod keychain;
mod machines;
#[cfg(test)]
mod machines_tests;
#[cfg(feature = "store")]
mod pack;
#[cfg(all(test, feature = "store"))]
mod pack_tests;
#[cfg(feature = "store")]
mod push;
#[cfg(all(test, feature = "store"))]
mod push_tests;
#[cfg(feature = "store")]
mod rebind;
#[cfg(all(test, feature = "store"))]
mod rebind_tests;
#[cfg(feature = "store")]
mod restore;
#[cfg(all(test, feature = "store"))]
mod restore_tests;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
#[cfg(test)]
mod tests;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "store")]
pub use adopt::{Adoption, SetAdoption, SetTarget, adopt_sets};
pub use auth::{
    Clock, DeviceCode, Logout, SessionUser, SignedIn, SystemClock, TokenStore, login, logout,
    system_tokens, system_tokens_for, whoami,
};
pub use client::{
    Client, HTTPS_DOCS_URL, Instance, Remote, Token, download_timeout, upload_timeout,
};
#[cfg(feature = "store")]
pub use hub::create_track;
pub use machines::{
    Machine, MachineView, NAME_TAKEN_CODE, NOT_REGISTERED_CODE, Presence, beat, platform, register,
    remove as remove_machine,
};
#[cfg(feature = "store")]
pub use pack::{
    MAX_OBJECT_BYTES, PACK_TARGET_BYTES, PackError, PackLimit, Place, object_sizes, packs,
    sample_object_sizes, save_objects,
};
#[cfg(feature = "store")]
pub use push::{
    Bound, BranchPush, Pending, PushError, PushOptions, PushProgress, PushReport, SamplesPush,
    pending, push, push_observed, pushes_samples, set_push_samples,
};
#[cfg(feature = "store")]
pub use rebind::{RebindError, Rebound, rebind};
#[cfg(feature = "store")]
pub use restore::{Progress, RestoreError, Restored, restore};

/// dit's per-user config: the instance this machine signs in to and the name it signs in as.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance: Option<Instance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<String>,
    /// This machine's stable id on the instance; see [`machine_id_at`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,
    /// The accelerator that shows the dit app's panel, e.g. `Alt+Shift+D`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    /// The largest file, in megabytes, the dit app uploads as a render; `0` is no limit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_upload_mb: Option<u64>,
    /// The folders the dit app watches for renders; the home folder when none are listed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub watch_roots: Vec<String>,
    /// Folders the render watcher skips, beside the ones it never enters.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded: Vec<String>,
}

const CONFIG_FILE: &str = "config.toml";

impl UserConfig {
    /// `dit/config.toml` in the platform's config folder: `~/Library/Application Support` on macOS.
    pub fn default_path() -> Result<PathBuf, RemoteError> {
        dirs::config_dir()
            .map(|dir| dir.join("dit").join(CONFIG_FILE))
            .ok_or(RemoteError::NoConfigDir)
    }

    /// The config at `path`; an empty one when there is no file yet.
    pub fn load(path: &Path) -> Result<Self, RemoteError> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text).map_err(|e| config_error(path, e)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(config_error(path, error)),
        }
    }

    /// Writes the config to `path`, creating its folder.
    pub fn save(&self, path: &Path) -> Result<(), RemoteError> {
        let text = toml::to_string(self).map_err(|e| config_error(path, e))?;
        crate::atomic::write(path, text.as_bytes()).map_err(|e| config_error(path, e))
    }

    /// The name this machine signs in as: see [`crate::machine::name`] for the order.
    pub fn machine(&self) -> String {
        crate::machine::name(self.machine.as_deref())
    }

    /// [`UserConfig::machine`] with the value of `DIT_MACHINE` given, not read from this process.
    pub fn machine_with(&self, env: Option<&str>) -> String {
        crate::machine::resolve(self.machine.as_deref(), env)
    }
}

fn config_error(path: &Path, error: impl std::fmt::Display) -> RemoteError {
    RemoteError::Config {
        path: path.display().to_string(),
        reason: error.to_string(),
    }
}

/// How many random bytes a machine id is made of; it is written as twice as many hex digits.
const MACHINE_ID_BYTES: usize = 16;

/// Whether `id` has the shape the instance accepts for a machine id: 16 to 64 letters, digits, `_` or `-`.
fn is_machine_id(id: &str) -> bool {
    (16..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// The id this machine goes by on the instance, kept in the config at `path`. It is made once, from the system's
/// random source, and stays the same however the machine is renamed or signed in again. A missing or malformed id is
/// replaced; the rest of the config is kept.
pub fn machine_id_at(path: &Path) -> Result<String, RemoteError> {
    let mut config = UserConfig::load(path)?;
    let had = config.machine_id.clone();
    let id = config.ensure_machine_id(path)?;
    if had.as_deref() != Some(id.as_str()) {
        config.save(path)?;
    }
    Ok(id)
}

impl UserConfig {
    /// This config's machine id, made and set in the config when it has none or a malformed one; the caller saves
    /// the config. `path` names the config in the error.
    fn ensure_machine_id(&mut self, path: &Path) -> Result<String, RemoteError> {
        if let Some(id) = self.machine_id.as_deref().filter(|id| is_machine_id(id)) {
            return Ok(id.to_string());
        }
        let mut random = [0u8; MACHINE_ID_BYTES];
        getrandom::fill(&mut random)
            .map_err(|error| config_error(path, format!("can't make a machine id: {error}")))?;
        let id = hex::encode(random);
        self.machine_id = Some(id.clone());
        Ok(id)
    }
}

/// Drops the machine id from the config at `path`, so the next [`machine_id_at`] makes a new one: a machine signed out
/// or removed on the instance is a new registration when it signs in again.
pub fn forget_machine_id(path: &Path) -> Result<(), RemoteError> {
    let mut config = UserConfig::load(path)?;
    if config.machine_id.take().is_some() {
        config.save(path)?;
    }
    Ok(())
}

/// A failure talking to an instance or keeping a sign-in. Each message is the one line the cli prints.
#[derive(Debug, Error)]
pub enum RemoteError {
    #[error("`{0}` is not an instance address. Give it as https://<host> or http://<host>:<port>.")]
    BadInstance(String),
    #[error("No instance to sign in to. Run dit login <url>.")]
    NoInstance,
    #[error("Not signed in to {host}. Run dit login.")]
    NotSignedIn { host: String },
    /// The instance refused the stored token.
    #[error("Signed out of {host}. Run dit login.")]
    SignedOut { host: String },
    /// The instance's certificate does not chain to a CA in the system trust store.
    #[error(
        "Can't verify {host}'s certificate. Install its CA: {}",
        HTTPS_DOCS_URL
    )]
    Certificate { host: String },
    /// No answer at all: the host did not resolve, refused the connection or never answered it in time.
    #[error("Can't reach {host}: {reason}")]
    Unreachable { host: String, reason: String },
    /// The host was reached and did not finish answering in time.
    #[error("{host} took too long to answer.")]
    TimedOut { host: String },
    /// The instance answered with a redirect, which dit does not follow: the instance lives at `location`.
    #[error("Unexpected answer from {host}: redirected to {location}; sign in with that address")]
    Redirected { host: String, location: String },
    /// An answer dit does not expect: a status, or a body that is not the JSON it should be.
    #[error("Unexpected answer from {host}: {detail}")]
    Unexpected { host: String, detail: String },
    /// The instance answered a request with an error of its own. `message` is the instance's own words, which is
    /// the line the cli prints; callers branch on `status` and `code`, and read `details`, the error body's
    /// `details` when it has one.
    #[error("{message}")]
    Refused {
        host: String,
        status: u16,
        code: Option<String>,
        details: Option<serde_json::Value>,
        message: String,
    },
    #[error("Sign-in was denied. Not signed in.")]
    Denied,
    #[error("The sign-in code expired. Not signed in.")]
    Expired,
    #[error("dit can't store a sign-in on this platform yet.")]
    NoKeyring,
    #[error("Can't use the keyring: {0}")]
    Keyring(String),
    #[error("{path}: {reason}")]
    Config { path: String, reason: String },
    #[error("This system has no user config folder.")]
    NoConfigDir,
}
