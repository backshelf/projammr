//! `script install` and `script status`: the control-surface script that tells the dit app which set a DAW has open.

use serde::Serialize;

use crate::commands::CliError;
use dit_core::Daw;
use dit_daws::registry;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitRow {
    pub daw: String,
    pub folder: String,
    /// The version this release carries.
    pub version: String,
    pub installed: bool,
    /// What is installed is this release's, every file as shipped.
    pub current: bool,
    /// Files written by this command; absent for `status`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub written: Option<usize>,
    /// Whether the DAW's last run had the script switched on; `None` when its log cannot say.
    pub enabled: Option<bool>,
    pub running: bool,
    #[serde(skip)]
    pub name: String,
}

#[derive(Serialize)]
pub struct ScriptResult {
    pub scripts: Vec<KitRow>,
}

fn row(daw: &dyn Daw, home: &std::path::Path, install: bool) -> Result<Option<KitRow>, CliError> {
    let Some(kit) = daw.script_kit(home) else {
        return Ok(None);
    };
    let written = if install {
        Some(kit.install().map_err(|e| {
            CliError(format!(
                "Could not install the script in {}: {e}",
                kit.folder.display()
            ))
        })?)
    } else {
        None
    };
    let status = kit.status();
    Ok(Some(KitRow {
        daw: daw.id().to_string(),
        name: daw.display_name().to_string(),
        folder: kit.folder.display().to_string(),
        version: kit.version.trim().to_string(),
        installed: status.installed,
        current: status.current,
        written,
        enabled: daw
            .script_enabled(home)
            .map_err(|e| CliError(e.to_string()))?,
        running: daw
            .log_open_set(home)
            .map_err(|e| CliError(e.to_string()))?
            .running,
    }))
}

/// Installs (or checks) the script of every DAW that has one, under the user's home.
pub fn script(install: bool) -> Result<ScriptResult, CliError> {
    let home = dirs::home_dir().ok_or_else(|| CliError("No home folder.".to_string()))?;
    let registry = registry();
    let mut scripts = Vec::new();
    for daw in registry.all() {
        scripts.extend(row(*daw, &home, install)?);
    }
    Ok(ScriptResult { scripts })
}
