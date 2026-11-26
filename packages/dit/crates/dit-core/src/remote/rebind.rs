//! Moving a repo's binding to the address its instance moved to, keeping the hub repo it pushes to.

use serde::Serialize;
use thiserror::Error;

use super::{Instance, Remote, RemoteError, hub};
use crate::repo::{Repo, RepoError};

/// What a rebind did.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rebound {
    /// The origin the repo was bound to.
    pub from: String,
    /// The origin it is bound to now; `from` when it already was.
    pub to: String,
    /// The sets whose push records were rewritten to `to`.
    pub sets: usize,
}

/// Why a rebind stopped. Each message is the one line the cli prints.
#[derive(Debug, Error)]
pub enum RebindError {
    #[error("This repo hasn't been pushed yet, so there's no instance to move it from.")]
    NotBound,
    /// Signing in at the new address is how the user shows it is theirs.
    #[error("This repo would push to {url}; dit is signed in to {signed_in}. Run dit login {url}.")]
    OtherInstance { url: String, signed_in: String },
    #[error("{url} has no repo {repo}; this repo stays bound to {bound}.")]
    NoSuchRepo {
        url: String,
        repo: i64,
        bound: String,
    },
    /// The repo id exists there, but it is not the repo these pushes went to.
    #[error(
        "{url}'s repo {repo} does not hold this repo's sets; this repo stays bound to {bound}."
    )]
    SetsNotHeld {
        url: String,
        repo: i64,
        bound: String,
    },
    #[error(transparent)]
    Remote(#[from] RemoteError),
    #[error(transparent)]
    Repo(#[from] RepoError),
}

/// Binds the repo to the instance at `url` in place of the one it is bound to, keeping its hub repo. The instance at
/// `url` must be the one `open` signs in to, and must hold the bound hub repo with every set this repo has pushed to
/// it, each under the session the push recorded; nothing is written until both hold.
/// A repo already bound to `url` succeeds without opening the remote or writing anything.
///
/// A rebind that stops partway is finished by running it again: [`Repo::rebind_remote`] writes the config last.
pub fn rebind(
    repo: &Repo,
    url: &str,
    open: impl FnOnce() -> Result<Remote, RemoteError>,
) -> Result<Rebound, RebindError> {
    let binding = repo.remote_binding()?.ok_or(RebindError::NotBound)?;
    let to = Instance::parse(url)?;
    let from = Instance::parse(&binding.instance)?;
    let rebound = |sets| Rebound {
        from: from.url().to_string(),
        to: to.url().to_string(),
        sets,
    };
    if from == to {
        return Ok(rebound(0));
    }
    let remote = open()?;
    let signed_in = remote.client().instance();
    if *signed_in != to {
        return Err(RebindError::OtherInstance {
            url: to.url().to_string(),
            signed_in: signed_in.url().to_string(),
        });
    }
    let held = match hub::repo(&remote, binding.repo) {
        Err(RemoteError::Refused {
            status: 403 | 404, ..
        }) => {
            return Err(RebindError::NoSuchRepo {
                url: to.url().to_string(),
                repo: binding.repo,
                bound: from.url().to_string(),
            });
        }
        answer => answer?,
    };
    let holds_every_set = repo
        .pushed_sets_to(&binding)?
        .iter()
        .all(|(set_id, pushed)| {
            held.sets
                .iter()
                .any(|set| set.dit_set_id == *set_id && set.session_id == pushed.session_id)
        });
    if !holds_every_set {
        return Err(RebindError::SetsNotHeld {
            url: to.url().to_string(),
            repo: binding.repo,
            bound: from.url().to_string(),
        });
    }
    let sets = repo.rebind_remote(&binding, to.url())?;
    Ok(rebound(sets))
}
