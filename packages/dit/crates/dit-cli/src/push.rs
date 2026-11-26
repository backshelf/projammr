//! `push` over `dit_core::remote`, and the push `commit` tries after it writes a commit.

use std::collections::BTreeMap;
use std::path::Path;

use dit_core::Repo;
use dit_core::remote::{self, PushError, PushOptions, PushReport, RemoteError};
use serde::Serialize;

use crate::commands::{CliError, open, resolve, working_files};
use crate::context::Context;

impl From<PushError> for CliError {
    fn from(error: PushError) -> Self {
        CliError(error.to_string())
    }
}

/// What a push reports: the hub's answer as JSON, with the host and each set's main file for the text.
#[derive(Serialize)]
pub struct PushResult {
    #[serde(flatten)]
    pub report: PushReport,
    /// The hub's refusal for its storage cap, which ended the push after `report`; `dit push` exits non-zero on it.
    #[serde(skip)]
    pub refused: Option<String>,
    #[serde(skip)]
    pub host: String,
    /// Each set's main file, by set id.
    #[serde(skip)]
    pub files: BTreeMap<String, String>,
}

/// Why a push did not happen.
pub enum PushFailure {
    /// The remote could not be opened (no instance, not signed in).
    Remote(RemoteError),
    /// The push itself failed.
    Push(PushError),
}

impl PushFailure {
    /// Whether the message already says the work is kept locally.
    pub fn says_kept(&self) -> bool {
        matches!(
            self,
            PushFailure::Push(PushError::Unreachable { .. } | PushError::TimedOut { .. })
        )
    }
}

impl std::fmt::Display for PushFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PushFailure::Remote(error) => error.fmt(f),
            PushFailure::Push(error) => error.fmt(f),
        }
    }
}

/// Opens the remote and pushes `options`. A sample the hub refused for its storage cap is not a failure here: what
/// the push sent is the result, with the refusal beside it, so it prints before the refusal does.
pub fn push_to_hub(
    cx: &Context,
    repo: &Repo,
    options: &PushOptions,
) -> Result<PushResult, PushFailure> {
    let remote = cx.remote.open().map_err(PushFailure::Remote)?;
    let (report, refused) = match remote::push(repo, &remote, options) {
        Ok(report) => (report, None),
        Err(PushError::StorageLimit { message, report }) => (*report, Some(message)),
        Err(error) => return Err(PushFailure::Push(error)),
    };
    let files = repo
        .sets()
        .map_err(|e| PushFailure::Push(PushError::Repo(e)))?;
    Ok(PushResult {
        report,
        refused,
        host: remote.client().instance().host().to_string(),
        files,
    })
}

/// Pushes everything pending, or the one set `set` names (any of its files).
pub fn push(
    cx: &mut Context,
    cwd: &Path,
    set: Option<&str>,
    project: Option<&str>,
) -> Result<PushResult, CliError> {
    let repo = open(cx, cwd)?;
    let set = match set {
        Some(name) => Some(resolve(&working_files(&repo)?, name)?.set_id),
        None => None,
    };
    let options = PushOptions {
        set,
        project: project.map(str::to_string),
        skip_samples: false,
        saves_only: false,
    };
    push_to_hub(cx, &repo, &options).map_err(|failure| CliError(failure.to_string()))
}
