//! A scripted hub that keeps what it is sent, for the tests of the backfill run: repos by name, the objects its packs
//! carry (and how many times each arrived), the sets adopted, and what was asked, with switches to make it refuse.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use dit_core::remote::Remote;
use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
use serde_json::{Value, json};

/// One `POST /repos/:id/sets` the hub was sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adopt {
    pub repo: i64,
    pub set: String,
    pub session: Option<i64>,
    pub track: Option<i64>,
    pub quiet: bool,
}

pub struct Hub {
    /// Every request, as `METHOD /path` without the `/api` prefix and the query.
    pub requests: Vec<String>,
    /// Repo name to id, in the order they were made.
    pub repos: BTreeMap<String, i64>,
    /// How many times each object arrived in a pack.
    pub objects: HashMap<String, usize>,
    /// The packs received.
    pub packs: usize,
    pub adopts: Vec<Adopt>,
    /// The set ids each `POST /repos/:id/saves` carried, by request.
    pub saves: Vec<(i64, String)>,
    pub tracks: i64,
    /// Sessions that adopting refuses: a repo holds them already.
    pub taken: BTreeSet<i64>,
    /// Names of repos whose pack uploads are refused as over the storage cap.
    pub full: BTreeSet<String>,
    /// Answer everything with 503.
    pub down: bool,
    /// Refuse every adoption with a 400.
    pub fail_adopt: bool,
    /// Answer everything with 401.
    pub signed_out: bool,
    /// The most bytes one pack may carry.
    pub max_bytes: usize,
    /// What `storage-check` says is left.
    pub remaining: Option<u64>,
    next_session: i64,
    sessions: HashMap<(i64, String), i64>,
}

impl Default for Hub {
    fn default() -> Self {
        Hub {
            requests: Vec::new(),
            repos: BTreeMap::new(),
            objects: HashMap::new(),
            packs: 0,
            adopts: Vec::new(),
            saves: Vec::new(),
            tracks: 0,
            taken: BTreeSet::new(),
            full: BTreeSet::new(),
            down: false,
            fail_adopt: false,
            signed_out: false,
            max_bytes: 1 << 20,
            remaining: None,
            next_session: 100,
            sessions: HashMap::new(),
        }
    }
}

impl Hub {
    /// How many requests went to a path that starts with `prefix`, whatever the method.
    pub fn count(&self, prefix: &str) -> usize {
        self.requests
            .iter()
            .filter(|request| {
                request
                    .split_once(' ')
                    .is_some_and(|(_, path)| path.starts_with(prefix))
            })
            .count()
    }

    pub fn repo_name(&self, id: i64) -> Option<&str> {
        self.repos
            .iter()
            .find(|(_, repo)| **repo == id)
            .map(|(name, _)| name.as_str())
    }

    /// The distinct objects the hub holds.
    pub fn held(&self) -> usize {
        self.objects.len()
    }
}

fn id_in(path: &str, after: &str) -> Option<i64> {
    path.strip_prefix(after)?.split('/').next()?.parse().ok()
}

/// The records of a pack: its objects' ids.
fn pack_ids(pack: &[u8]) -> Vec<String> {
    let mut ids = Vec::new();
    let mut at = 0;
    while at < pack.len() {
        ids.push(
            pack[at..at + 32]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        );
        let length = u32::from_le_bytes(pack[at + 33..at + 37].try_into().unwrap()) as usize;
        at += 37 + length;
    }
    ids
}

fn answer(hub: &mut Hub, request: &Recorded) -> Reply {
    let path = request
        .path_only()
        .strip_prefix("/api")
        .unwrap_or(request.path_only())
        .to_string();
    hub.requests.push(format!("{} {path}", request.method));
    if hub.signed_out {
        return Reply::json(401, json!({"error": "Signed out"}).to_string());
    }
    if hub.down {
        return Reply::json(503, json!({"error": "The hub is busy"}).to_string());
    }
    let body = || -> Value { request.json() };
    let ok = |value: Value| Reply::json(200, value.to_string());
    match (request.method.as_str(), path.as_str()) {
        ("GET", "/uploads/limits") => ok(json!({"maxBytes": hub.max_bytes})),
        ("POST", "/tracks") => {
            hub.tracks += 1;
            ok(json!({"id": 500 + hub.tracks}))
        }
        ("POST", p) if p.starts_with("/projects/") && p.ends_with("/repos/storage-check") => {
            let mut seen = BTreeSet::new();
            let (mut bytes, mut held) = (0u64, 0u64);
            for object in body()["objects"].as_array().unwrap() {
                let hash = object["hash"].as_str().unwrap().to_string();
                if !seen.insert(hash.clone()) {
                    continue;
                }
                if hub.objects.contains_key(&hash) {
                    held += 1;
                } else {
                    bytes += object["size"].as_u64().unwrap();
                }
            }
            ok(json!({"bytes": bytes, "held": held, "remainingBytes": hub.remaining}))
        }
        ("POST", p) if p.starts_with("/projects/") && p.ends_with("/repos") => {
            let name = body()["name"].as_str().unwrap().to_string();
            let next = hub.repos.len() as i64 + 1;
            let id = *hub.repos.entry(name).or_insert(next);
            ok(json!({"id": id}))
        }
        ("GET", p) if p.starts_with("/repos/") => ok(json!({
            "id": id_in(p, "/repos/").unwrap(),
            "sets": [],
            "pushSamples": false,
            "pushSamplesForced": false,
        })),
        ("POST", p) if p.ends_with("/sets") && hub.fail_adopt => {
            hub.adopts.push(Adopt {
                repo: id_in(p, "/repos/").unwrap(),
                set: String::new(),
                session: None,
                track: None,
                quiet: false,
            });
            Reply::json(400, json!({"error": "Adopting is refused"}).to_string())
        }
        ("POST", p) if p.ends_with("/sets") => {
            let repo = id_in(p, "/repos/").unwrap();
            let body = body();
            let set = body["ditSetId"].as_str().unwrap().to_string();
            let session = body["sessionId"].as_i64();
            hub.adopts.push(Adopt {
                repo,
                set: set.clone(),
                session,
                track: body["trackId"].as_i64(),
                quiet: body["quiet"].as_bool().unwrap_or(false),
            });
            if session.is_some_and(|id| hub.taken.contains(&id)) {
                return Reply::json(
                    409,
                    json!({"error": "That session already belongs to a repo", "code": "set_taken"})
                        .to_string(),
                );
            }
            let next = hub.next_session;
            let id = match hub.sessions.get(&(repo, set.clone())) {
                Some(id) => *id,
                None => {
                    let id = session.unwrap_or(next);
                    if session.is_none() {
                        hub.next_session += 1;
                    }
                    hub.sessions.insert((repo, set.clone()), id);
                    id
                }
            };
            ok(json!({"ditSetId": set, "sessionId": id}))
        }
        ("POST", p) if p.ends_with("/saves") => {
            let repo = id_in(p, "/repos/").unwrap();
            let set = body()["ditSetId"].as_str().unwrap().to_string();
            hub.saves.push((repo, set));
            ok(json!({"saved": 1}))
        }
        ("POST", p) if p.ends_with("/segments") || p.ends_with("/commits") => ok(json!({})),
        ("POST", p) if p.ends_with("/objects/missing") => {
            let missing: Vec<Value> = body()["hashes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|hash| !hub.objects.contains_key(hash.as_str().unwrap()))
                .cloned()
                .collect();
            ok(json!({"missing": missing, "claimed": []}))
        }
        ("POST", p) if p.ends_with("/objects") => {
            let repo = id_in(p, "/repos/").unwrap();
            if hub
                .repo_name(repo)
                .is_some_and(|name| hub.full.contains(name))
            {
                return Reply::json(
                    413,
                    json!({"error": "Storage is full: 5 GB of 5 GB.", "code": "storage_limit"})
                        .to_string(),
                );
            }
            hub.packs += 1;
            let (mut stored, mut known) = (0, 0);
            for id in pack_ids(&request.body) {
                let count = hub.objects.entry(id).or_insert(0);
                if *count == 0 {
                    stored += 1;
                } else {
                    known += 1;
                }
                *count += 1;
            }
            ok(json!({"stored": stored, "known": known}))
        }
        other => panic!("unexpected request {other:?}"),
    }
}

/// A hub, the shared state behind it and a connection to it as the machine "Studio iMac".
pub fn hub() -> (MockServer, Arc<Mutex<Hub>>, Remote) {
    let state = Arc::new(Mutex::new(Hub::default()));
    let shared = state.clone();
    let server = MockServer::route(move |request| answer(&mut shared.lock().unwrap(), request));
    let remote = remote_to(&server);
    (server, state, remote)
}
