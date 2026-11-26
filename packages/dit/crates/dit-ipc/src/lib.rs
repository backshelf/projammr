//! The local socket between the `dit` command line and the dit app.
//!
//! While the app runs it is the only process that touches the Keychain and the only one that records saves and
//! pushes, so the cli hands it the command line and prints what comes back: the same text, `--json` bytes and exit
//! code as a local run, with no token ever crossing the socket. With nothing listening the cli runs the command
//! itself.
//!
//! The wire is in [`protocol`]; [`Client`] is the cli's side and [`Server`] the app's, which answers through a
//! [`Handler`]. The socket is a Unix socket: on other platforms this crate has the wire and nothing to connect with.

mod protocol;
mod wire;

#[cfg(unix)]
mod client;
#[cfg(unix)]
mod server;

use std::io;
use std::path::PathBuf;

use thiserror::Error;

pub use protocol::{Body, Done, Env, Frame, Op, Request, Run, Stream, VERSION};

#[cfg(unix)]
pub use client::{Client, OP_TIMEOUT};
#[cfg(unix)]
pub use server::{Handler, Server, Serving};

/// The socket's name beside the user config; the lock file that guards it adds `.lock`.
const SOCKET_FILE: &str = "dit.sock";

/// `dit/dit.sock` in the platform's config folder, beside the user config: `~/Library/Application Support` on
/// macOS. `None` when the platform has no config folder.
pub fn default_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("dit").join(SOCKET_FILE))
}

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("{context}: {source}")]
    Io {
        context: String,
        #[source]
        source: io::Error,
    },
    /// The server did not run the request: it speaks another version, or could not read it.
    #[error("{0}")]
    Refused(String),
    /// The server hung up before the command ended.
    #[error("The dit app closed the connection before the command finished.")]
    Closed,
    /// The other side sent something that is not this protocol.
    #[error("Unexpected answer from the dit app: {0}")]
    Protocol(String),
}

impl IpcError {
    pub(crate) fn io(context: impl Into<String>, source: io::Error) -> Self {
        IpcError::Io {
            context: context.into(),
            source,
        }
    }
}
