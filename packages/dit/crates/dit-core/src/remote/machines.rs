//! Telling the instance this machine is here: the machine's id, name and platform, and what it has open, sent on a
//! beat. The instance lists the account's machines from these.

use serde::{Deserialize, Serialize};

use super::{Remote, RemoteError};

/// The `code` of the 409 the instance answers with when another of the account's machines already has the name.
pub const NAME_TAKEN_CODE: &str = "machine_name_taken";

/// The `code` of the 409 the instance answers a request with when the machine id it names has no live machine
/// behind it: [`Remote`] registers the machine and sends the request again.
pub const NOT_REGISTERED_CODE: &str = "machine_not_registered";

/// The longest machine name the hub takes, in UTF-16 code units: its limit is on a JavaScript string's length.
const HUB_NAME_UNITS: usize = 64;

/// `name` as the hub stores it: trimmed, then cut to the longest prefix of whole characters that is at most
/// [`HUB_NAME_UNITS`] code units of UTF-16, so a character outside the Basic Multilingual Plane (two units) is never
/// split. The hub cuts the same way, so a name sent cut and one sent whole are the same name there.
pub(crate) fn hub_name(name: &str) -> &str {
    let name = name.trim();
    let mut units = 0;
    for (at, character) in name.char_indices() {
        units += character.len_utf16();
        if units > HUB_NAME_UNITS {
            return &name[..at];
        }
    }
    name
}

/// This machine as the instance knows it. The id is made of letters, digits, `_` and `-`, so it goes in a path as it
/// is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Machine {
    /// The stable id from [`machine_id_at`](super::machine_id_at).
    pub id: String,
    /// The name the account's other machines see it by.
    pub name: String,
    /// What it runs on, as [`platform`] names it.
    pub platform: String,
    /// The version of dit that is beating.
    pub app_version: String,
}

/// What a machine has open at a beat.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Presence {
    /// The session open in a window, if there is one.
    pub open_session_id: Option<i64>,
    /// The repos this machine keeps a clone of.
    pub repo_ids: Vec<i64>,
}

/// A machine as the instance answers a beat with it; the fields dit does not use are left out.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineView {
    pub id: String,
    pub name: String,
    /// Whether the instance has heard from the machine recently.
    pub online: bool,
    pub open_session_id: Option<i64>,
}

/// The body of a beat.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Beat<'a> {
    name: &'a str,
    platform: &'a str,
    app_version: &'a str,
    open_session_id: Option<i64>,
    repo_ids: &'a [i64],
}

/// What the machine runs on, as the instance shows it: `macOS`, `Linux` or `Windows`, and the operating system's own
/// name for any other.
pub fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "linux" => "Linux",
        "windows" => "Windows",
        other => other,
    }
}

/// The first beat of a sign-in: nothing open and no repos. It lets the instance refuse a name another machine of the
/// account has ([`NAME_TAKEN_CODE`], as a 409 [`RemoteError::Refused`]) before the beat loop runs.
pub fn register(remote: &Remote, machine: &Machine) -> Result<MachineView, RemoteError> {
    beat(remote, machine, &Presence::default())
}

/// Tells the instance `machine` is here with `presence`, making the machine known to it on the first beat.
pub fn beat(
    remote: &Remote,
    machine: &Machine,
    presence: &Presence,
) -> Result<MachineView, RemoteError> {
    remote.put_once(
        &format!("/machines/{}", machine.id),
        &Beat {
            name: hub_name(&machine.name),
            platform: &machine.platform,
            app_version: &machine.app_version,
            open_session_id: presence.open_session_id,
            repo_ids: &presence.repo_ids,
        },
    )
}

/// Removes `remote`'s machine from the account's list on the instance: what signing out of the app does, with the
/// session left open. The instance answers the id with a 401 from then on, so the machine's id is forgotten with
/// [`forget_machine_id`](super::forget_machine_id) and the next sign-in registers a new one.
pub fn remove(remote: &Remote, machine_id: &str) -> Result<(), RemoteError> {
    remote.delete(&format!("/machines/{machine_id}"))
}
