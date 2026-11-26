//! `remote set` over `dit_core::remote::rebind`.

use std::path::Path;

use dit_core::remote::{self, RebindError, Rebound};

use crate::commands::{CliError, open};
use crate::context::Context;

impl From<RebindError> for CliError {
    fn from(error: RebindError) -> Self {
        CliError(error.to_string())
    }
}

/// Binds the repo to the instance at `url`, keeping the hub repo it pushes to.
pub fn set(cx: &Context, cwd: &Path, url: &str) -> Result<Rebound, CliError> {
    let repo = open(cx, cwd)?;
    Ok(remote::rebind(&repo, url, || cx.remote.open())?)
}
