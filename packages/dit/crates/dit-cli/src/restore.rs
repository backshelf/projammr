//! `restore` over `dit_core::remote::restore`.

use std::path::{Path, PathBuf};

use dit_core::RepoList;
use dit_core::remote::{self, Progress, Restored};
use dit_daws::registry;

use crate::commands::CliError;
use crate::context::Context;

impl From<remote::RestoreError> for CliError {
    fn from(error: remote::RestoreError) -> Self {
        CliError(error.to_string())
    }
}

/// The repos a restore looks through for the one the commit belongs to: the one `cwd` is in, when it is in one, then
/// those the dit app tracks (`repos.toml`, beside the user config).
fn candidates(cx: &Context, cwd: &Path) -> Vec<PathBuf> {
    let mut repos: Vec<PathBuf> = dit_core::Repo::open(cwd, &registry())
        .map(|repo| repo.root().to_path_buf())
        .into_iter()
        .collect();
    if let Ok(config) = cx.remote.config_path()
        && let Ok(list) = RepoList::load(&config.with_file_name("repos.toml"))
    {
        for repo in list.repos {
            if !repos.contains(&repo) {
                repos.push(repo);
            }
        }
    }
    repos
}

/// Restores the hub's commit `commit` as a new branch `name` of the repo that tracks it.
pub fn restore(
    cx: &mut Context,
    cwd: &Path,
    commit: i64,
    name: Option<&str>,
) -> Result<Restored, CliError> {
    let repos = candidates(cx, cwd);
    let hub = cx
        .remote
        .open()
        .map_err(|error| CliError(error.to_string()))?;
    let mut last = None;
    let restored = remote::restore(&repos, &registry(), &hub, commit, name, &mut |step| {
        // One line when the fetching starts and one when the file is written: a progress bar's two ends.
        let line = match step {
            Progress::Fetching { .. } if last.is_none() => Some("Fetching from the hub…"),
            Progress::Writing => Some("Writing the file…"),
            Progress::Fetching { .. } => None,
        };
        last = Some(step);
        if let Some(line) = line {
            cx.say(line);
        }
    })?;
    Ok(restored)
}
