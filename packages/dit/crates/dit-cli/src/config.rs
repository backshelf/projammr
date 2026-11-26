//! `config push-samples` over `dit_core::remote::set_push_samples`, and how the cached setting reads.

use std::path::Path;

use dit_core::PushSamples;
use dit_core::remote;
use serde::Serialize;

use crate::commands::{CliError, open};
use crate::context::Context;

/// Whether the hub repo takes this repo's sample objects, as `config` and `status` say it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SamplesMode {
    /// The repo's own switch is on.
    Pushed,
    /// The instance pushes samples for every repo.
    Instance,
    /// Sample objects stay on this computer.
    LocalOnly,
}

impl From<PushSamples> for SamplesMode {
    fn from(setting: PushSamples) -> Self {
        if setting.forced {
            SamplesMode::Instance
        } else if setting.enabled {
            SamplesMode::Pushed
        } else {
            SamplesMode::LocalOnly
        }
    }
}

#[derive(Serialize)]
pub struct PushSamplesResult {
    pub samples: SamplesMode,
}

/// Prints the cached setting, or with `value` sets it on the hub first. A repo that has never heard from its hub is
/// local only.
pub fn push_samples(
    cx: &Context,
    cwd: &Path,
    value: Option<bool>,
) -> Result<PushSamplesResult, CliError> {
    let repo = open(cx, cwd)?;
    let setting = match value {
        Some(on) => remote::set_push_samples(&repo, || cx.remote.open(), on)?,
        None => repo.push_samples()?.unwrap_or(PushSamples {
            enabled: false,
            forced: false,
        }),
    };
    Ok(PushSamplesResult {
        samples: setting.into(),
    })
}
