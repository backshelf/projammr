//! What a command reads from and writes to outside the repo: the environment it was given, the stream its
//! warnings go to and where it gets a signed-in connection. The terminal's `dit` and the app answering for it
//! build a context each, so a command never reaches for the process's own stderr, environment or Keychain.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use dit_core::machine;
use dit_core::remote::{self, Remote, RemoteError, TokenStore, UserConfig};
use dit_daemon::backfill::BackfillControl;
use dit_daemon::renders::RenderControl;
pub use dit_ipc::Env;

/// Where a command gets the user config and a signed-in connection.
pub trait RemoteSource: Send + Sync {
    /// The user config's file.
    fn config_path(&self) -> Result<PathBuf, RemoteError>;

    /// The store the session token is kept in.
    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError>;

    /// The connection the user config and token store give. A config naming no instance is `NoInstance` before the
    /// token store is touched, so a machine never signed in never reaches the Keychain. A sign-in made before
    /// machines had ids gets its id here, so what it pushes names the machine from then on.
    fn open(&self) -> Result<Remote, RemoteError> {
        let path = self.config_path()?;
        let mut config = UserConfig::load(&path)?;
        if config.instance.is_none() {
            return Err(RemoteError::NoInstance);
        }
        config.machine_id = Some(remote::machine_id_at(&path)?);
        Remote::open(&config, self.tokens()?.as_ref())
    }
}

/// The user config in its default place and the system token store: the terminal's own `dit`.
pub struct SystemRemote;

impl RemoteSource for SystemRemote {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        UserConfig::default_path()
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        remote::system_tokens()
    }
}

/// One command's surroundings.
pub struct Context<'a> {
    /// The variables the command reads, which are the requester's, not necessarily this process's.
    pub env: Env,
    /// Where warnings and what a person reads mid-command go; stdout stays the result alone.
    pub err: &'a mut dyn Write,
    pub remote: &'a dyn RemoteSource,
    /// The dit app's render engine, when the command is being run by the app: `dit renders` asks it rather than the
    /// ledger.
    pub renders: Option<&'a dyn RenderControl>,
    /// The dit app's backfill run, when the command is being run by the app: `dit backfill` brings folders in through
    /// it, so the app's window and the terminal are one run. With none, the run is the terminal's own.
    pub backfill: Option<&'a dyn BackfillControl>,
    /// What a repo's machine-name lookup has to say, held until [`Context::flush_notes`]: the lookup runs inside a
    /// save, which cannot borrow `err`.
    notes: Arc<Mutex<Vec<String>>>,
}

impl<'a> Context<'a> {
    pub fn new(env: Env, err: &'a mut dyn Write, remote: &'a dyn RemoteSource) -> Self {
        Context {
            env,
            err,
            remote,
            renders: None,
            backfill: None,
            notes: Arc::default(),
        }
    }

    /// A line on stderr. A stderr that cannot be written to is not a reason to fail the command.
    pub(crate) fn say(&mut self, line: impl std::fmt::Display) {
        self.tell(line);
    }

    /// A line on stderr, and whether it was written. A command that runs on after its reader has gone (a backfill
    /// the terminal started) learns from this that nobody is watching.
    pub(crate) fn tell(&mut self, line: impl std::fmt::Display) -> bool {
        writeln!(self.err, "{line}").is_ok()
    }

    /// Who commits: `DIT_AUTHOR`, else `USER`, else `unknown`.
    pub(crate) fn author(&self) -> String {
        [&self.env.author, &self.env.user]
            .into_iter()
            .flatten()
            .find(|value| !value.is_empty())
            .cloned()
            .unwrap_or_else(|| "unknown".to_string())
    }

    /// The name saves are recorded under: the user config's, else `DIT_MACHINE`, else the host name. It is looked up
    /// when the first save of the repo is recorded: a command that records none never reads the user config. A
    /// config that does not load leaves the config out, with one note for [`Context::flush_notes`], so no local
    /// command fails on it.
    pub(crate) fn saving_machine(&self) -> impl Fn() -> String + Send + Sync + 'static {
        let name = OnceLock::new();
        let from_env = self.env.machine.clone();
        let config = self.remote.config_path().ok();
        let notes = self.notes.clone();
        move || {
            name.get_or_init(|| machine_name(config.as_deref(), from_env.as_deref(), &notes))
                .clone()
        }
    }

    /// Writes the notes a machine-name lookup left. Call after anything that records a save.
    pub(crate) fn flush_notes(&mut self) {
        let notes = std::mem::take(&mut *self.notes.lock().unwrap_or_else(|e| e.into_inner()));
        for note in notes {
            self.say(note);
        }
    }
}

fn machine_name(
    config: Option<&Path>,
    from_env: Option<&str>,
    notes: &Mutex<Vec<String>>,
) -> String {
    let Some(path) = config else {
        return machine::resolve(None, from_env);
    };
    match UserConfig::load(path) {
        Ok(config) => config.machine_with(from_env),
        Err(error) => {
            let name = machine::resolve(None, from_env);
            notes
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(format!(
                    "warning: {}; recording saves as {name} instead",
                    one_line(&error.to_string())
                ));
            name
        }
    }
}

/// A parse error as one line: its message without the source excerpt the TOML parser draws under it.
fn one_line(error: &str) -> String {
    error
        .lines()
        .filter(|line| !line.contains('|'))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join(": ")
}
