//! Adopting a repo's sets into the sessions and tracks their producer chose, ahead of any push.
//!
//! A first push adopts each set into a session of its own. A set that belongs to a session the hub already has (one
//! the web made) is adopted into that session instead, or into a track of the project, by naming it
//! here. What is adopted is recorded as the push records it, so the push that follows finds every set adopted and
//! sends only its saves.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::hub::{self, HubRepo};
use super::push::{PushError, bind_project, signed_in_to};
use super::{NOT_REGISTERED_CODE, Remote, RemoteError};
use crate::repo::{PushedSet, Repo};

/// Where the hub should put a set when it adopts it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SetTarget {
    /// The session with this id, which no repo holds yet: the set's saves fill it.
    Session(i64),
    /// A new session on the track with this id.
    Track(i64),
    /// A new session on a track made first, titled so, in the project.
    NewTrack(String),
}

/// How the hub answered the adoption of one set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetAdoption {
    /// The set belongs to this hub session now (or already did).
    Adopted { session_id: i64 },
    /// The hub refused: the session is held by a repo already, in the hub's words. The set is left unadopted, so a
    /// push would give it a session of its own: whoever adopted must not push it.
    Taken { message: String },
}

/// What adopting a repo's sets did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adoption {
    /// The hub repo the sets belong to: the repo's binding, which this call made when the repo had none.
    pub repo_id: i64,
    /// Each set asked for, in the order asked, with the hub's answer.
    pub sets: Vec<(String, SetAdoption)>,
}

/// Adopts each of `targets` (a set id and where it goes) into the hub repo `repo` is bound to, which is first made
/// in the project `project_id`, named after the folder, when the repo is not bound. A set already adopted into the
/// bound repo is left as it is. `quiet` has the hub log no activity for the adoptions.
///
/// A refusal for one set (its session is taken) is that set's [`SetAdoption::Taken`] and the rest go on; anything
/// else ends the call, with what was adopted before it recorded. An unknown set is refused before any request. Two
/// sets sent to the same new track share the one track.
pub fn adopt_sets(
    repo: &Repo,
    remote: &Remote,
    project_id: i64,
    targets: &[(String, SetTarget)],
    quiet: bool,
) -> Result<Adoption, PushError> {
    let sets = repo.sets()?;
    for (set_id, _) in targets {
        if !sets.contains_key(set_id) {
            return Err(PushError::NoSuchSet(set_id.clone()));
        }
    }
    let binding = match repo.remote_binding()? {
        Some(binding) => {
            signed_in_to(remote, &binding)?;
            binding
        }
        None => bind_project(repo, remote, project_id)?,
    };
    let hub = HubRepo {
        remote,
        id: binding.repo,
    };
    let mut made: HashMap<&str, i64> = HashMap::new();
    let mut adoption = Adoption {
        repo_id: binding.repo,
        sets: Vec::with_capacity(targets.len()),
    };
    for (set_id, target) in targets {
        if let Some(pushed) = repo.pushed_to(set_id, &binding)? {
            adoption.sets.push((
                set_id.clone(),
                SetAdoption::Adopted {
                    session_id: pushed.session_id,
                },
            ));
            continue;
        }
        let (session_id, track_id) = match target {
            SetTarget::Session(id) => (Some(*id), None),
            SetTarget::Track(id) => (None, Some(*id)),
            SetTarget::NewTrack(title) => {
                let id = match made.get(title.as_str()) {
                    Some(id) => *id,
                    None => {
                        let id = hub::create_track(remote, project_id, title)?;
                        made.insert(title, id);
                        id
                    }
                };
                (None, Some(id))
            }
        };
        let main_rel = &sets[set_id];
        let file_name = main_rel.rsplit('/').next().unwrap_or(main_rel);
        let local_path = repo.root().to_string_lossy();
        let local_filepath = repo.root().join(main_rel).to_string_lossy().into_owned();
        let answer = match hub.adopt_set_into(
            set_id,
            file_name,
            session_id,
            track_id,
            quiet,
            Some(local_path.as_ref()),
            Some(local_filepath.as_str()),
        ) {
            Ok(session_id) => {
                repo.write_pushed(
                    set_id,
                    &PushedSet {
                        instance: binding.instance.clone(),
                        repo_id: binding.repo,
                        session_id,
                        branches: Default::default(),
                    },
                )?;
                SetAdoption::Adopted { session_id }
            }
            Err(RemoteError::Refused {
                status: 409,
                code,
                message,
                ..
            }) if code.as_deref() != Some(NOT_REGISTERED_CODE) => SetAdoption::Taken { message },
            Err(error) => return Err(error.into()),
        };
        adoption.sets.push((set_id.clone(), answer));
    }
    Ok(adoption)
}
