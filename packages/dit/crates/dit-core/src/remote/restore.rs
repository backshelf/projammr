//! Restoring a commit the hub holds as a new branch of a repo on this computer.
//!
//! A commit made on another computer is on the hub and not in this repo's store. Restoring it fetches what its new
//! branch needs, from the hub's repo, checks every object against its id, and only then writes anything here: the
//! commit's Commit and Save objects and those of every ancestor back to the first one this repo already holds (a
//! history walk reads them all), and the commit's own save's tree, side list and leaves (or the one leaf of a save
//! that holds its file whole). The branch is then checked out like one made from a local commit, and the new file is
//! recorded, which is the first save of the branch.
//!
//! The objects come from `POST /repos/:id/objects/fetch`, which answers a pack-like body: per held hash, `id (32
//! bytes) | kind (1) | length (u32 LE) | the stored zstd frame`. When the hub does not hold every hash asked for it
//! answers `409` with the code `objects_missing` and the missing hashes in `details.hashes`, before any record; that
//! refuses the restore before anything is written, since a branch over a history with a hole could not be read or
//! pushed. The hub limits fetches to a few a minute, so a request asks for
//! everything known to be needed at that point: one generation of ancestors with the saves of the generation before
//! it and the next layer of the commit's own save together, not an object at a time.
//!
//! A commit that is already in this repo's store is checked out with no request beyond the one that names it.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::pack::MAX_OBJECT_BYTES;
use super::{Instance, Remote, RemoteError};
use crate::daw::Registry;
use crate::repo::{MAIN_BRANCH, Repo, RepoError, Save};
use crate::store::{
    ObjectId, ObjectKind, ObjectRead, StoreError, decode_chunked, read_tree_object,
};

/// The most a fetch answer may take, a bound on what a hub can make this computer hold in memory.
const MAX_FETCH_BYTES: usize = 1 << 30;

/// The code of the 409 the hub answers a fetch with when it does not hold every hash asked for.
const OBJECTS_MISSING_CODE: &str = "objects_missing";

/// Bytes before each frame: the id, the kind and the frame's length.
const RECORD_HEADER: usize = 32 + 1 + 4;

/// Where a restore is, for a progress bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// Objects fetched so far; said after each fetch the hub answers.
    Fetching { objects: usize },
    /// The objects are being stored and the file written.
    Writing,
}

/// What a restore made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// The repo's project folder.
    pub repo: PathBuf,
    pub set_id: String,
    pub branch: String,
    /// The new working file.
    pub file: PathBuf,
    /// The commit the branch starts from.
    pub commit: ObjectId,
    /// Objects fetched from the hub; none for a commit this repo already held.
    pub fetched: usize,
    /// Requests that fetched them.
    pub requests: usize,
}

/// Why a restore did not happen. Each message is one line the cli prints.
#[derive(Debug, Error)]
pub enum RestoreError {
    #[error("Not tracked by dit on this computer.")]
    NotTracked,
    #[error("That commit has no save to restore.")]
    NoSave,
    #[error(
        "The hub does not hold all of that commit's history ({} objects missing), so it cannot be restored.",
        .0.len()
    )]
    Incomplete(Vec<ObjectId>),
    #[error(
        "That commit is on branch {0}, which this computer does not have, so a branch made from it could not be pushed."
    )]
    BranchNotHere(String),
    #[error("{} already exists. Try the name {suggestion}.", .path.display())]
    BranchFileExists { path: PathBuf, suggestion: String },
    #[error("A branch named {name} already exists. Try the name {suggestion}.")]
    BranchExists { name: String, suggestion: String },
    #[error("The hub's answer is not what was asked for: {0}")]
    BadAnswer(String),
    #[error(transparent)]
    Remote(#[from] RemoteError),
    #[error(transparent)]
    Repo(#[from] RepoError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// The hub's view of a commit, `GET /commits/:id`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitView {
    hash: String,
    save_hash: Option<String>,
    branch: String,
    dit_set_id: String,
    repo_id: i64,
    session_id: i64,
}

/// One row of `GET /sessions/:id/commits`, newest first: the fields that link a chain.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRow {
    hash: String,
    parent_hash: Option<String>,
    save_hash: Option<String>,
}

/// The most rows the hub's history answers with.
const HISTORY_ROWS: usize = 500;

#[derive(Serialize)]
struct FetchBody<'a> {
    hashes: &'a [ObjectId],
}

/// An object read from a fetch answer: its kind and its body.
type Object = (ObjectKind, Vec<u8>);

/// What `restore` reads objects through: those fetched so far, then the repo's own store.
struct Known<'a> {
    fetched: &'a HashMap<ObjectId, Object>,
    repo: &'a Repo,
}

impl ObjectRead for Known<'_> {
    fn get(&self, id: &ObjectId) -> Result<Object, StoreError> {
        match self.fetched.get(id) {
            Some(object) => Ok(object.clone()),
            None => self.repo.store().get(id),
        }
    }
}

/// Restores the hub's commit `commit_id` as a new branch `name` of the repo, among `repos`, that is bound to the
/// commit's hub repo and has its set. `name` is the branch to make; without one it is `restore-` and the commit's
/// first seven hex digits, made unique. `progress` hears each step.
pub fn restore(
    repos: &[PathBuf],
    registry: &Registry,
    remote: &Remote,
    commit_id: i64,
    name: Option<&str>,
    progress: &mut dyn FnMut(Progress),
) -> Result<Restored, RestoreError> {
    let view: CommitView = remote.get(&format!("/commits/{commit_id}"))?;
    let hash = ObjectId::from_str(&view.hash)
        .map_err(|_| RestoreError::BadAnswer(format!("`{}` is not a commit hash", view.hash)))?;
    let repo = locate(repos, registry, remote.client().instance(), &view)?;
    let set_id = view.dit_set_id.clone();

    let branch = match name {
        Some(name) => name.to_string(),
        None => repo.free_branch_name(&set_id, &format!("restore-{}", &view.hash[..7]))?,
    };
    let mut fetch = Fetch {
        remote,
        hub_repo: view.repo_id,
        repo: &repo,
        objects: HashMap::new(),
        requests: 0,
        progress,
    };
    if !repo.store().contains(&hash) {
        let save_hash = view
            .save_hash
            .as_deref()
            .ok_or(RestoreError::NoSave)?
            .parse::<ObjectId>()
            .map_err(|_| RestoreError::BadAnswer("a save hash that is not a hash".to_string()))?;
        if view.branch != MAIN_BRANCH && !repo.branch_files(&set_id)?.contains_key(&view.branch) {
            return Err(RestoreError::BranchNotHere(view.branch));
        }
        let known = fetch.learn(view.session_id, hash)?;
        fetch.chain(hash, save_hash, known)?;
    }

    let fetched = fetch.objects.len();
    let requests = fetch.requests;
    (fetch.progress)(Progress::Writing);
    let mut batch = repo.store().batch();
    for (id, (kind, body)) in &fetch.objects {
        if batch.put(*kind, body)? != *id {
            return Err(StoreError::Corrupt(*id).into());
        }
    }
    batch.finish()?;

    let file = repo
        .checkout_new_branch(&hash, &branch)
        .map_err(|error| match error {
            RepoError::BranchFileExists(path) => RestoreError::BranchFileExists {
                suggestion: suggestion(&repo, &set_id, &branch),
                path,
            },
            RepoError::BranchExists(existing) => RestoreError::BranchExists {
                suggestion: suggestion(&repo, &set_id, &branch),
                name: existing,
            },
            other => other.into(),
        })?;
    repo.record_save(&file)?;
    Ok(Restored {
        repo: repo.root().to_path_buf(),
        set_id,
        branch,
        file,
        commit: hash,
        fetched,
        requests,
    })
}

/// A branch name like `name` that is free, for an error to offer.
fn suggestion(repo: &Repo, set_id: &str, name: &str) -> String {
    repo.free_branch_name(set_id, name)
        .unwrap_or_else(|_| format!("{name}-2"))
}

/// The first of `repos` that is bound to the commit's hub repo on the instance signed in to and has its set.
fn locate(
    repos: &[PathBuf],
    registry: &Registry,
    instance: &Instance,
    view: &CommitView,
) -> Result<Repo, RestoreError> {
    for path in repos {
        let Ok(repo) = Repo::open(path, registry) else {
            continue;
        };
        let Ok(Some(binding)) = repo.remote_binding() else {
            continue;
        };
        let bound = Instance::parse(&binding.instance).ok();
        if binding.repo == view.repo_id
            && bound.as_ref() == Some(instance)
            && repo
                .sets()
                .is_ok_and(|sets| sets.contains_key(&view.dit_set_id))
        {
            return Ok(repo);
        }
    }
    Err(RestoreError::NotTracked)
}

/// What is fetched for the commit's own save, a layer at a time: a save names its tree and side list (or its raw
/// leaf), a tree names its leaves, and a large leaf names its chunks.
enum Target {
    /// The save itself is in this round's request.
    Save(ObjectId),
    /// The save's tree and side list, or its raw leaf.
    Document(Vec<ObjectId>, Option<ObjectId>),
    /// The leaves, which may be Chunked.
    Leaves(Vec<ObjectId>),
    /// The chunks of the Chunked leaves.
    Chunks(Vec<ObjectId>),
    Done,
}

impl Target {
    fn wanted(&self) -> Vec<ObjectId> {
        match self {
            Target::Save(_) | Target::Done => Vec::new(),
            Target::Document(objects, _) | Target::Leaves(objects) | Target::Chunks(objects) => {
                objects.clone()
            }
        }
    }
}

struct Fetch<'a> {
    remote: &'a Remote,
    hub_repo: i64,
    repo: &'a Repo,
    /// Everything fetched and checked, held until the whole chain is known to be complete.
    objects: HashMap<ObjectId, Object>,
    requests: usize,
    progress: &'a mut dyn FnMut(Progress),
}

impl Fetch<'_> {
    /// Fetches the commit `hash`, its ancestors back to the first this repo holds, their saves, and what the commit's
    /// own save `save_hash` needs to be written out. Each round asks for everything known to be needed so far.
    fn chain(
        &mut self,
        hash: ObjectId,
        save_hash: ObjectId,
        known: Vec<(ObjectId, ObjectId)>,
    ) -> Result<(), RestoreError> {
        let mut commits = vec![hash];
        let mut saves = vec![save_hash];
        for (commit, save) in known {
            commits.push(commit);
            saves.push(save);
        }
        let mut target = Target::Save(save_hash);
        loop {
            let mut wanted = commits.clone();
            wanted.extend(&saves);
            wanted.extend(target.wanted());
            self.fetch(&wanted)?;

            let (mut next_commits, mut next_saves) = (Vec::new(), Vec::new());
            for id in &commits {
                let commit = self.commit(id)?;
                if *id == hash && commit.save != save_hash {
                    return Err(RestoreError::BadAnswer(
                        "a commit that does not name the save the hub says it does".to_string(),
                    ));
                }
                if let Some(parent) = commit.parent
                    && !self.repo.store().contains(&parent)
                    && !self.objects.contains_key(&parent)
                {
                    next_commits.push(parent);
                }
                if !self.repo.store().contains(&commit.save)
                    && !self.objects.contains_key(&commit.save)
                {
                    next_saves.push(commit.save);
                }
            }
            target = self.advance(target)?;
            if next_commits.is_empty() && next_saves.is_empty() && matches!(target, Target::Done) {
                return Ok(());
            }
            commits = next_commits;
            saves = next_saves;
        }
    }

    /// The commits and their saves from `hash`'s parent back to the first this repo holds, as the session's history
    /// lists them (one request, newest first, up to 500 rows), so the whole chain is fetched at once. A chain the
    /// history does not reach back far enough is finished by reading the commits themselves.
    fn learn(
        &self,
        session_id: i64,
        hash: ObjectId,
    ) -> Result<Vec<(ObjectId, ObjectId)>, RestoreError> {
        let rows: Vec<HistoryRow> = self.remote.get(&format!(
            "/sessions/{session_id}/commits?limit={HISTORY_ROWS}"
        ))?;
        let by_hash: HashMap<ObjectId, (Option<ObjectId>, Option<ObjectId>)> = rows
            .iter()
            .filter_map(|row| {
                let id = row.hash.parse().ok()?;
                let parent = row.parent_hash.as_deref().and_then(|p| p.parse().ok());
                let save = row.save_hash.as_deref().and_then(|s| s.parse().ok());
                Some((id, (parent, save)))
            })
            .collect();
        let mut chain = Vec::new();
        let mut at = hash;
        while let Some((Some(parent), _)) = by_hash.get(&at) {
            if self.repo.store().contains(parent) {
                break;
            }
            let Some((_, Some(save))) = by_hash.get(parent) else {
                chain.push((*parent, None));
                break;
            };
            chain.push((*parent, Some(*save)));
            at = *parent;
        }
        // An ancestor the rows lack is fetched as a commit alone and read for its save.
        Ok(chain
            .into_iter()
            .filter_map(|(commit, save)| save.map(|save| (commit, save)))
            .collect())
    }

    /// The layer of the commit's own save that follows the one just fetched.
    fn advance(&self, target: Target) -> Result<Target, RestoreError> {
        let known = Known {
            fetched: &self.objects,
            repo: self.repo,
        };
        Ok(match target {
            Target::Save(id) => {
                let save = self.save(&id)?;
                match (save.raw, save.document()) {
                    (Some(raw), _) => Target::Leaves(vec![raw]),
                    (None, Some((tree, side))) => Target::Document(vec![*tree, *side], Some(*tree)),
                    (None, None) => {
                        return Err(RestoreError::BadAnswer(
                            "a save with neither a document nor a file".to_string(),
                        ));
                    }
                }
            }
            Target::Document(_, tree) => {
                let tree = tree.expect("a document stage names its tree");
                let mut leaves = Vec::new();
                for part in read_tree_object(&known, &tree)?.parts {
                    leaves.extend(part.leaves.iter().map(|leaf| leaf.object));
                }
                Target::Leaves(leaves)
            }
            Target::Leaves(leaves) => {
                let mut chunks = Vec::new();
                for leaf in leaves {
                    let (kind, body) = known.get(&leaf)?;
                    if kind == ObjectKind::Chunked {
                        chunks.extend(decode_chunked(&body)?);
                    }
                }
                if chunks.is_empty() {
                    Target::Done
                } else {
                    Target::Chunks(chunks)
                }
            }
            Target::Chunks(_) | Target::Done => Target::Done,
        })
    }

    fn commit(&self, id: &ObjectId) -> Result<crate::repo::Commit, RestoreError> {
        self.json(id, ObjectKind::Commit)
    }

    fn save(&self, id: &ObjectId) -> Result<Save, RestoreError> {
        self.json(id, ObjectKind::Save)
    }

    /// The JSON object `id` of `kind`, from what was fetched or from the repo.
    fn json<T: serde::de::DeserializeOwned>(
        &self,
        id: &ObjectId,
        kind: ObjectKind,
    ) -> Result<T, RestoreError> {
        let known = Known {
            fetched: &self.objects,
            repo: self.repo,
        };
        let (got, body) = known.get(id)?;
        if got != kind {
            return Err(RestoreError::BadAnswer(format!(
                "object {id} is a {got:?}, not a {kind:?}"
            )));
        }
        serde_json::from_slice(&body)
            .map_err(|error| RestoreError::BadAnswer(format!("object {id}: {error}")))
    }

    /// Asks the hub for those of `ids` that are neither here nor already fetched, in as few requests as it allows,
    /// and checks what comes back. A hash the hub does not hold refuses the restore.
    fn fetch(&mut self, ids: &[ObjectId]) -> Result<(), RestoreError> {
        let mut seen = std::collections::HashSet::new();
        let ask: Vec<ObjectId> = ids
            .iter()
            .filter(|id| {
                !self.objects.contains_key(id)
                    && !self.repo.store().contains(id)
                    && seen.insert(**id)
            })
            .copied()
            .collect();
        for hashes in ask.chunks(FETCH_CHUNK) {
            let bytes = match self.remote.post_for_bytes(
                &format!("/repos/{}/objects/fetch", self.hub_repo),
                &FetchBody { hashes },
                MAX_FETCH_BYTES,
            ) {
                Ok(bytes) => bytes,
                Err(RemoteError::Refused {
                    status: 409,
                    code: Some(code),
                    details,
                    ..
                }) if code == OBJECTS_MISSING_CODE => {
                    return Err(RestoreError::Incomplete(missing_hashes(details.as_ref())?));
                }
                Err(error) => return Err(error.into()),
            };
            self.requests += 1;
            read_records(&bytes, hashes, &mut self.objects)?;
            (self.progress)(Progress::Fetching {
                objects: self.objects.len(),
            });
        }
        Ok(())
    }
}

/// The most hashes one fetch may ask for.
const FETCH_CHUNK: usize = 10_000;

/// The hashes a fetch refusal's `details` name: `{ "hashes": [hex, …] }`.
fn missing_hashes(details: Option<&serde_json::Value>) -> Result<Vec<ObjectId>, RestoreError> {
    let bad = |what: &str| RestoreError::BadAnswer(what.to_string());
    let hashes = details
        .and_then(|details| details.get("hashes"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| bad("a refusal that does not list the hashes it is missing"))?;
    if hashes.is_empty() {
        return Err(bad("a refusal that lists no missing hash"));
    }
    hashes
        .iter()
        .map(|hash| {
            hash.as_str()
                .and_then(|hash| hash.parse().ok())
                .ok_or_else(|| RestoreError::BadAnswer(format!("`{hash}` is not a hash")))
        })
        .collect()
}

/// Reads the records of a fetch answer into `objects`, checking each against its id. The answer must hold exactly
/// the objects asked for: a body that stops short (the hub's stream broke) or carries another object is refused.
fn read_records(
    bytes: &[u8],
    asked: &[ObjectId],
    objects: &mut HashMap<ObjectId, Object>,
) -> Result<(), RestoreError> {
    let bad = |what: &str| RestoreError::BadAnswer(what.to_string());
    let mut wanted: std::collections::HashSet<ObjectId> = asked.iter().copied().collect();
    let mut rest = bytes;
    while !rest.is_empty() {
        let header = rest
            .get(..RECORD_HEADER)
            .ok_or_else(|| bad("an answer that stops inside a record's header"))?;
        let id = ObjectId::from_bytes(header[..32].try_into().expect("32 bytes"));
        let kind_byte = header[32];
        let length = u32::from_le_bytes(header[33..37].try_into().expect("4 bytes")) as usize;
        let frame = rest
            .get(RECORD_HEADER..RECORD_HEADER + length)
            .ok_or_else(|| bad("an answer that stops short of a frame"))?;
        rest = &rest[RECORD_HEADER + length..];
        if !wanted.remove(&id) {
            return Err(RestoreError::BadAnswer(format!(
                "object {id}, which was not asked for or came twice"
            )));
        }
        objects.insert(id, open_frame(&id, kind_byte, frame)?);
    }
    if !wanted.is_empty() {
        return Err(bad(
            "an answer that leaves out objects it did not list as missing",
        ));
    }
    Ok(())
}

/// A stored frame (zstd of `kind byte | body`) as the object it holds, checked against `id` and the record's kind.
fn open_frame(id: &ObjectId, kind_byte: u8, frame: &[u8]) -> Result<Object, RestoreError> {
    let bad = |what: &str| RestoreError::BadAnswer(format!("object {id}: {what}"));
    let kind = ObjectKind::from_byte(kind_byte).ok_or_else(|| bad("an unknown kind"))?;
    let decoder = zstd::stream::read::Decoder::new(frame)
        .map_err(|_| bad("a frame that does not decompress"))?;
    let mut content = Vec::new();
    decoder
        .take(MAX_OBJECT_BYTES as u64 + 1)
        .read_to_end(&mut content)
        .map_err(|_| bad("a frame that does not decompress"))?;
    if content.len() > MAX_OBJECT_BYTES {
        return Err(bad("a frame that expands past the object limit"));
    }
    if content.first() != Some(&kind_byte) {
        return Err(bad("a frame whose kind is not the record's"));
    }
    content.drain(..1);
    if ObjectId::of(kind, &content) != *id {
        return Err(RestoreError::Store(StoreError::Corrupt(*id)));
    }
    Ok((kind, content))
}

#[cfg(test)]
mod shapes {
    use super::*;

    /// `GET /commits/:id` and a row of `GET /sessions/:id/commits`, as the hub answered them (extra fields kept).
    #[test]
    fn the_hubs_commit_and_history_bodies_parse() {
        let view: CommitView = serde_json::from_str(
            r#"{"id":3,"hash":"6a5798d5591ff85f31d07689492014ad755c0bfd9508bbabdb9669d0717cff1e","parentHash":"0aa2e1b2159480990873d9c55c4a3792d3ef350dbd532a8132efd8715fd7c0b3","saveHash":"eede44dfc5ac8f98c05e7bcba5cefb101345cb97ebe566fe96dfc9185cf342cb","message":"faster still","kind":"user","committedAt":"2026-10-21T06:13:09.604Z","branch":"main","ditSetId":"5b021f3004dcfce3","repoId":1,"sessionId":1,"sessionName":"Arranged Set"}"#,
        )
        .unwrap();
        assert_eq!(
            (view.repo_id, view.session_id, view.branch.as_str()),
            (1, 1, "main")
        );
        assert!(view.save_hash.is_some());

        let rows: Vec<HistoryRow> = serde_json::from_str(
            r#"[{"id":3,"hash":"6a5798d5591ff85f31d07689492014ad755c0bfd9508bbabdb9669d0717cff1e","message":"faster still","kind":"user","committedAt":"2026-10-21T06:13:09.604Z","machineName":"e2e-a","authorId":"x","branch":"main","parentHash":"0aa2e1b2159480990873d9c55c4a3792d3ef350dbd532a8132efd8715fd7c0b3","saveHash":"eede44dfc5ac8f98c05e7bcba5cefb101345cb97ebe566fe96dfc9185cf342cb","authorName":"E2E Tester","saves":[{"id":3,"fileUpdatedAt":"2026-10-21T06:13:09.576Z"}]}]"#,
        )
        .unwrap();
        assert_eq!(rows[0].parent_hash.as_deref().map(str::len), Some(64));
    }
}
