//! `dit cover set`: uploads a local image file and pins it as the cover of a track, collection or project.

use std::path::Path;

use dit_core::remote::{CoverImage, CoverTarget, set_cover};
use serde::Serialize;

use crate::commands::CliError;
use crate::context::Context;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSetResult {
    pub target: CoverTarget,
    pub image: CoverImage,
}

/// Uploads `file` (resolved against `cwd`) and pins it on `target`.
pub fn set(
    cx: &mut Context,
    cwd: &Path,
    file: &Path,
    target: CoverTarget,
) -> Result<CoverSetResult, CliError> {
    let path = cwd.join(file);
    let remote = cx.remote.open().map_err(|e| CliError(e.to_string()))?;
    let image = set_cover(&remote, &path, target).map_err(|e| CliError(e.to_string()))?;
    Ok(CoverSetResult { target, image })
}
