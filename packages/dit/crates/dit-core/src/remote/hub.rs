//! The hub's repo endpoints as typed calls: the bodies a push sends and the answers it reads.

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

use super::{Remote, RemoteError, upload_timeout};
use crate::meta::{SampleRef, SetMeta};
use crate::repo::{CommitKind, PushSamples, Save, Segment, Source};
use crate::store::ObjectId;

/// The most hashes one `objects/missing` request may ask about.
const MISSING_CHUNK: usize = 10_000;

/// A project the signed-in user belongs to.
#[derive(Debug, Deserialize)]
pub(super) struct Project {
    pub(super) id: i64,
    pub(super) name: String,
}

/// The projects the signed-in user belongs to.
pub(super) fn projects(remote: &Remote) -> Result<Vec<Project>, RemoteError> {
    remote.get("/me/projects")
}

/// A set a hub repo has adopted, and the session that holds it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AdoptedSet {
    pub(super) dit_set_id: String,
    pub(super) session_id: i64,
}

/// A hub repo with the sets it has adopted and whether it takes sample objects.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepoWithSets {
    pub(super) sets: Vec<AdoptedSet>,
    pub(super) push_samples: bool,
    pub(super) push_samples_forced: bool,
}

impl RepoWithSets {
    pub(super) fn push_samples(&self) -> PushSamples {
        PushSamples {
            enabled: self.push_samples,
            forced: self.push_samples_forced,
        }
    }
}

/// Sets the hub repo `id`'s push-samples switch; the answer is the repo as `repo` reads it. A viewer, or an instance
/// that will not show the repo, is refused.
pub(super) fn set_push_samples(
    remote: &Remote,
    id: i64,
    on: bool,
) -> Result<RepoWithSets, RemoteError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        push_samples: bool,
    }
    remote.patch(&format!("/repos/{id}"), &Body { push_samples: on })
}

/// Asks for the hub repo `id` and the sets it has adopted; an instance that does not hold it, or will not show it to
/// the signed-in user, refuses.
pub(super) fn repo(remote: &Remote, id: i64) -> Result<RepoWithSets, RemoteError> {
    remote.get(&format!("/repos/{id}"))
}

/// Makes a track titled `title` in the project and returns its id, as the app's track proposal does.
pub fn create_track(remote: &Remote, project_id: i64, title: &str) -> Result<i64, RemoteError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body<'a> {
        project_id: i64,
        title: &'a str,
    }
    #[derive(Deserialize)]
    struct Created {
        id: i64,
    }
    let created: Created = remote.post("/tracks", &Body { project_id, title })?;
    Ok(created.id)
}

/// The id of the project's repo named `name`, created when there is none.
pub(super) fn create_repo(
    remote: &Remote,
    project_id: i64,
    name: &str,
    local_path: Option<&str>,
) -> Result<i64, RemoteError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        local_path: Option<&'a str>,
    }
    #[derive(Deserialize)]
    struct Created {
        id: i64,
    }
    let created: Created = remote.post(
        &format!("/projects/{project_id}/repos"),
        &Body { name, local_path },
    )?;
    Ok(created.id)
}

/// The most bytes one upload may carry on this instance.
pub(super) fn upload_limit(remote: &Remote) -> Result<usize, RemoteError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Limits {
        max_bytes: usize,
    }
    Ok(remote.get::<Limits>("/uploads/limits")?.max_bytes)
}

/// What a pack upload did: objects the repo now holds that it did not, and objects it already held.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub(super) struct Stored {
    pub(super) stored: usize,
    pub(super) known: usize,
}

/// The answer of `objects/missing`.
#[derive(Debug, Default, Deserialize)]
pub(super) struct Held {
    /// Not held: to upload.
    pub(super) missing: Vec<ObjectId>,
    /// Held by a repo of a project the caller is a member of, and now linked to this repo without an upload.
    #[serde(default)]
    pub(super) claimed: Vec<ObjectId>,
}

/// One commit as `POST /repos/:id/commits` takes it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommitItem {
    pub(super) hash: ObjectId,
    pub(super) save_hash: ObjectId,
    pub(super) parent_hash: Option<ObjectId>,
    pub(super) message: String,
    pub(super) kind: CommitKind,
    pub(super) committed_at: i64,
    pub(super) machine_name: String,
    pub(super) saves: Vec<CommitSave>,
    /// The leaf ids of the commit's own save's samples, listed once; the hub says how many of them it holds.
    pub(super) sample_objects: Vec<ObjectId>,
    /// The commit's own Save and its Commit object, which the hub links to the repo once it holds them: what lets a
    /// restore rebuild the commit's lineage from the hub. Empty in a commit sent before they were uploaded.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) lineage_objects: Vec<ObjectId>,
}

/// A save a commit covers, with the objects it rebuilds from.
#[derive(Debug, Serialize)]
pub(super) struct CommitSave {
    pub(super) hash: ObjectId,
    pub(super) objects: Vec<ObjectId>,
}

/// One save as `POST /repos/:id/saves` takes it: its ids and metadata, never its content. A save that holds its file
/// whole (`raw`) has no `xmlHash`, `tree`, `side` or `meta`, and `raw` names the leaf that holds the file; every
/// other save omits `raw`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveItem<'a> {
    hash: &'a ObjectId,
    xml_hash: Option<&'a str>,
    tree: Option<&'a ObjectId>,
    side: Option<&'a ObjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw: Option<&'a ObjectId>,
    file_updated_at: i64,
    machine_name: &'a str,
    meta: Option<&'a SetMeta>,
    view_only: bool,
    unreadable: bool,
    samples: &'a [SampleRef],
}

impl<'a> SaveItem<'a> {
    fn new(id: &'a ObjectId, save: &'a Save) -> Self {
        SaveItem {
            hash: id,
            xml_hash: save.xml_hash.as_deref(),
            tree: save.tree.as_ref(),
            side: save.side.as_ref(),
            raw: save.raw.as_ref(),
            file_updated_at: save.file_updated_at,
            machine_name: &save.machine,
            meta: save.meta.as_ref(),
            view_only: save.view_only,
            unreadable: save.unreadable,
            samples: &save.samples,
        }
    }
}

/// A repo on the hub.
pub(super) struct HubRepo<'a> {
    pub(super) remote: &'a Remote,
    pub(super) id: i64,
}

impl HubRepo<'_> {
    /// Adopts a set into the repo and returns the hub session that holds it; a set already adopted answers with its
    /// session.
    pub(super) fn adopt_set(
        &self,
        set_id: &str,
        file_name: &str,
        local_path: Option<&str>,
        local_filepath: Option<&str>,
    ) -> Result<i64, RemoteError> {
        self.adopt_set_into(
            set_id,
            file_name,
            None,
            None,
            false,
            local_path,
            local_filepath,
        )
    }

    /// Like [`HubRepo::adopt_set`], into the session `session_id` names, or onto the track `track_id` names, when
    /// either is given. A session a repo holds already is a 409. `quiet` has the hub log no activity.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn adopt_set_into(
        &self,
        set_id: &str,
        file_name: &str,
        session_id: Option<i64>,
        track_id: Option<i64>,
        quiet: bool,
        local_path: Option<&str>,
        local_filepath: Option<&str>,
    ) -> Result<i64, RemoteError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            dit_set_id: &'a str,
            file_name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            session_id: Option<i64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            track_id: Option<i64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            local_path: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            local_filepath: Option<&'a str>,
            #[serde(skip_serializing_if = "std::ops::Not::not")]
            quiet: bool,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Adopted {
            session_id: i64,
        }
        let adopted: Adopted = self.remote.post(
            &self.path("sets"),
            &Body {
                dit_set_id: set_id,
                file_name,
                session_id,
                track_id,
                local_path,
                local_filepath,
                quiet,
            },
        )?;
        Ok(adopted.session_id)
    }

    /// Records saves of a branch, by hash; a save the hub already has is updated in place.
    pub(super) fn push_saves(
        &self,
        set_id: &str,
        branch: &str,
        saves: &[(ObjectId, Save)],
        local_path: Option<&str>,
        local_filepath: Option<&str>,
    ) -> Result<(), RemoteError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            dit_set_id: &'a str,
            branch: &'a str,
            saves: Vec<SaveItem<'a>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            local_path: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            local_filepath: Option<&'a str>,
        }
        let saves = saves
            .iter()
            .map(|(id, save)| SaveItem::new(id, save))
            .collect();
        self.remote.post::<IgnoredAny>(
            &self.path("saves"),
            &Body {
                dit_set_id: set_id,
                branch,
                saves,
                local_path,
                local_filepath,
            },
        )?;
        Ok(())
    }

    /// Which of `ids` the repo does not hold and which the hub linked to it without an upload, asked in chunks the
    /// hub accepts.
    pub(super) fn missing(&self, ids: &[ObjectId]) -> Result<Held, RemoteError> {
        #[derive(Serialize)]
        struct Body<'a> {
            hashes: &'a [ObjectId],
        }
        let mut held = Held::default();
        for hashes in ids.chunks(MISSING_CHUNK) {
            let answer: Held = self
                .remote
                .post(&self.path("objects/missing"), &Body { hashes })?;
            held.missing.extend(answer.missing);
            held.claimed.extend(answer.claimed);
        }
        Ok(held)
    }

    /// Uploads one pack.
    pub(super) fn push_pack(&self, pack: &[u8]) -> Result<Stored, RemoteError> {
        self.remote
            .post_bytes(&self.path("objects"), pack, upload_timeout(pack.len()))
    }

    /// Records the spans this machine had a branch's set open, by their start: a span the hub has is extended in
    /// place.
    pub(super) fn push_segments(
        &self,
        set_id: &str,
        branch: &str,
        machine: &str,
        segments: &[Segment],
    ) -> Result<(), RemoteError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            dit_set_id: &'a str,
            segments: Vec<Item<'a>>,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Item<'a> {
            branch: &'a str,
            machine_name: &'a str,
            started_at: i64,
            ended_at: i64,
            source: Source,
        }
        let segments = segments
            .iter()
            .map(|segment| Item {
                branch,
                machine_name: machine,
                started_at: segment.start,
                ended_at: segment.end,
                source: segment.source,
            })
            .collect();
        self.remote.post::<IgnoredAny>(
            &self.path("segments"),
            &Body {
                dit_set_id: set_id,
                segments,
            },
        )?;
        Ok(())
    }

    /// Records commits of a branch, oldest first.
    pub(super) fn push_commits(
        &self,
        set_id: &str,
        branch: &str,
        commits: &[CommitItem],
    ) -> Result<(), RemoteError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            dit_set_id: &'a str,
            branch: &'a str,
            commits: &'a [CommitItem],
        }
        self.remote.post::<IgnoredAny>(
            &self.path("commits"),
            &Body {
                dit_set_id: set_id,
                branch,
                commits,
            },
        )?;
        Ok(())
    }

    fn path(&self, rest: &str) -> String {
        format!("/repos/{}/{rest}", self.id)
    }
}
