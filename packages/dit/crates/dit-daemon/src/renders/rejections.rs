//! Keeping the ledger's rejections and the hub's the same list.
//!
//! The hub is the record: "Not a bounce" files by fingerprint, shared by every machine of the user, and "Never here"
//! folders of one machine, under `/machines/rejections`. The ledger keeps a copy the engine reads synchronously for
//! each file it follows, and a change made there waits in [`Ledger::unsynced`] until the hub has taken it, so a
//! rejection made while the hub is away reaches it later. [`flush`] sends what waits; [`sync`] is what a hub being
//! attached runs: it sends what waits, uploads this machine's lists once (they were kept only here before the hub
//! held them), then makes the ledger's lists the hub's.

use std::io;
use std::path::{Path, PathBuf};

use dit_core::remote::{Remote, RemoteError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ledger::{Ledger, Remembered, Unsynced};

const PATH: &str = "/machines/rejections";

/// The most items the hub takes in one request.
const CHUNK: usize = 1000;

/// Why the ledger and the hub could not be brought together; either way what waits in the ledger stays.
#[derive(Debug)]
pub enum SyncError {
    Ledger(io::Error),
    Remote(RemoteError),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Ledger(error) => error.fmt(f),
            SyncError::Remote(error) => error.fmt(f),
        }
    }
}

impl From<io::Error> for SyncError {
    fn from(error: io::Error) -> Self {
        SyncError::Ledger(error)
    }
}

impl From<RemoteError> for SyncError {
    fn from(error: RemoteError) -> Self {
        SyncError::Remote(error)
    }
}

/// `GET /machines/rejections`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Listed {
    not_a_bounce: Vec<HeldFile>,
    never_here: Vec<HeldFolder>,
}

#[derive(Deserialize)]
struct HeldFile {
    id: i64,
    fingerprint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeldFolder {
    id: i64,
    machine_id: String,
    folder: String,
}

/// One item of `POST /machines/rejections`.
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum Item {
    NotABounce {
        fingerprint: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_name: Option<String>,
    },
    NeverHere {
        machine_id: String,
        folder: String,
    },
}

impl Item {
    /// The item that tells the hub of `remembered`; a folder needs the machine's id, which a connection without one
    /// cannot give.
    fn of(remembered: &Remembered, machine_id: Option<&str>) -> Option<Item> {
        match remembered {
            Remembered::NotABounce {
                fingerprint,
                file_name,
            } => Some(Item::NotABounce {
                fingerprint: fingerprint.clone(),
                file_name: file_name.clone(),
            }),
            Remembered::NeverHere { folder } => Some(Item::NeverHere {
                machine_id: machine_id?.to_string(),
                folder: folder.to_string_lossy().into_owned(),
            }),
        }
    }
}

fn list(remote: &Remote) -> Result<Listed, RemoteError> {
    remote.get(PATH)
}

fn send(remote: &Remote, items: &[Item]) -> Result<(), RemoteError> {
    for chunk in items.chunks(CHUNK) {
        remote.post::<Value>(PATH, &serde_json::json!({ "items": chunk }))?;
    }
    Ok(())
}

/// Compares two folder paths, case-insensitively on macOS and Windows where filesystems
/// preserve case without distinguishing it.
fn same_folder(a: &Path, b: &Path) -> bool {
    #[cfg(any(target_os = "macos", windows))]
    {
        let normalize = |path: &Path| -> Vec<String> {
            path.components()
                .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
                .collect()
        };
        normalize(a) == normalize(b)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        a == b
    }
}

/// Tells the hub what the ledger holds that it has not heard: turn-downs made and turn-downs taken back. What the
/// hub took leaves the ledger's waiting list; what it did not stays for the next time. A connection that names no
/// machine leaves the folders waiting.
pub fn flush(ledger_path: &Path, remote: &Remote) -> Result<(), SyncError> {
    let waiting = Ledger::load(ledger_path)?.unsynced;
    if waiting.is_empty() {
        return Ok(());
    }
    let machine = remote.client().machine_id();
    let (removals, additions): (Vec<Unsynced>, Vec<Unsynced>) =
        waiting.into_iter().partition(|change| change.removed);

    let mut sent = Vec::new();
    let mut items = Vec::new();
    for change in additions {
        if let Some(item) = Item::of(&change.remembered, machine) {
            items.push(item);
            sent.push(change);
        }
    }
    send(remote, &items)?;
    Ledger::update(ledger_path, |ledger| ledger.told(&sent))?;

    if removals.is_empty() {
        return Ok(());
    }
    let held = list(remote)?;
    let mut told = Vec::with_capacity(removals.len());
    for change in removals {
        let id = match &change.remembered {
            Remembered::NotABounce { fingerprint, .. } => held
                .not_a_bounce
                .iter()
                .find(|file| file.fingerprint == *fingerprint)
                .map(|file| file.id),
            // A turn-down is the machine's own: with no machine named it cannot be found, and waits.
            Remembered::NeverHere { .. } if machine.is_none() => continue,
            Remembered::NeverHere { folder } => held
                .never_here
                .iter()
                .find(|held| {
                    Some(held.machine_id.as_str()) == machine
                        && same_folder(Path::new(&held.folder), folder.as_path())
                })
                .map(|held| held.id),
        };
        // One the hub does not list, or answers 404 for, is gone already.
        if let Some(id) = id {
            match remote.delete(&format!("{PATH}/{id}")) {
                Ok(()) | Err(dit_core::remote::RemoteError::Refused { status: 404, .. }) => {}
                Err(error) => return Err(error.into()),
            }
        }
        told.push(change);
    }
    Ledger::update(ledger_path, |ledger| ledger.told(&told))?;
    Ok(())
}

/// What a hub being attached runs: [`flush`], then the one-time upload of this machine's lists, then the ledger's
/// lists become the hub's (so a turn-down made on another machine reaches the engine, and one removed on the web
/// stops holding). Nothing is changed in the ledger unless every request answered. Returns whether the lists the
/// engine reads changed.
pub fn sync(ledger_path: &Path, remote: &Remote) -> Result<bool, SyncError> {
    let Some(machine) = remote.client().machine_id().map(str::to_string) else {
        return Ok(false);
    };
    flush(ledger_path, remote)?;
    let held = Ledger::load(ledger_path)?;
    if !held.uploaded {
        let mut items: Vec<Item> = held
            .rejected
            .iter()
            .map(|fingerprint| Item::NotABounce {
                fingerprint: fingerprint.clone(),
                file_name: held.file_name_of(fingerprint),
            })
            .collect();
        items.extend(held.never_here.iter().map(|folder| Item::NeverHere {
            machine_id: machine.clone(),
            folder: folder.to_string_lossy().into_owned(),
        }));
        send(remote, &items)?;
        Ledger::update(ledger_path, |ledger| ledger.uploaded = true)?;
    }
    let listed = list(remote)?;
    let files: Vec<String> = listed
        .not_a_bounce
        .into_iter()
        .map(|file| file.fingerprint)
        .collect();
    let folders: Vec<PathBuf> = listed
        .never_here
        .into_iter()
        .filter(|held| held.machine_id == machine)
        .map(|held| PathBuf::from(held.folder))
        .collect();
    Ok(Ledger::update(ledger_path, |ledger| {
        let before = (ledger.rejected.clone(), ledger.never_here.clone());
        ledger.adopt_hub(files, folders);
        before != (ledger.rejected.clone(), ledger.never_here.clone())
    })?)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use dit_core::remote::test_support::{MockServer, Reply, remote_as, remote_to};
    use serde_json::json;

    use super::super::driver;
    use super::super::ledger::ProposalFile;
    use super::*;

    const MACHINE_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const MACHINE_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    /// What the hub holds of the user's rejections.
    #[derive(Default)]
    struct Hub {
        files: Vec<(i64, String, Option<String>)>,
        folders: Vec<(i64, String, String)>,
        next: i64,
        posts: usize,
    }

    /// A hub that keeps the user's rejections the way `/machines/rejections` does.
    fn hub() -> (MockServer, Arc<Mutex<Hub>>) {
        let state = Arc::new(Mutex::new(Hub::default()));
        let shared = state.clone();
        let server = MockServer::route(move |request| {
            let mut hub = shared.lock().unwrap();
            let path = request.path_only().to_string();
            match (request.method.as_str(), path.as_str()) {
                ("GET", "/api/machines/rejections") => Reply::json(
                    200,
                    json!({
                        "notABounce": hub.files.iter().map(|(id, fingerprint, name)| {
                            json!({ "id": id, "fingerprint": fingerprint, "fileName": name, "createdAt": "2026-10-21T09:00:00.000Z" })
                        }).collect::<Vec<_>>(),
                        "neverHere": hub.folders.iter().map(|(id, machine, folder)| {
                            json!({ "id": id, "machineId": machine, "folder": folder })
                        }).collect::<Vec<_>>(),
                    })
                    .to_string(),
                ),
                ("POST", "/api/machines/rejections") => {
                    hub.posts += 1;
                    for item in request.json()["items"].as_array().unwrap() {
                        hub.next += 1;
                        let id = hub.next;
                        match item["kind"].as_str().unwrap() {
                            "not-a-bounce" => {
                                let print = item["fingerprint"].as_str().unwrap().to_string();
                                if !hub.files.iter().any(|(_, held, _)| *held == print) {
                                    let name = item["fileName"].as_str().map(str::to_string);
                                    hub.files.push((id, print, name));
                                }
                            }
                            _ => {
                                let machine = item["machineId"].as_str().unwrap().to_string();
                                let folder = item["folder"].as_str().unwrap().to_string();
                                if !hub.folders.iter().any(|(_, m, f)| *m == machine && *f == folder) {
                                    hub.folders.push((id, machine, folder));
                                }
                            }
                        }
                    }
                    Reply::json(200, json!({ "items": [] }).to_string())
                }
                ("DELETE", rest) if rest.starts_with("/api/machines/rejections/") => {
                    let id: i64 = rest.rsplit('/').next().unwrap().parse().unwrap();
                    hub.files.retain(|(held, _, _)| *held != id);
                    hub.folders.retain(|(held, _, _)| *held != id);
                    Reply::json(204, "")
                }
                other => panic!("unexpected request {other:?}"),
            }
        });
        (server, state)
    }

    /// A ledger in a temp folder with one proposal of one file, fingerprinted `print`.
    struct Machine {
        _dir: tempfile::TempDir,
        ledger: PathBuf,
        id: u64,
    }

    fn machine(print: &str) -> Machine {
        let dir = tempfile::tempdir().unwrap();
        let ledger = dir.path().join("renders.json");
        let id = Ledger::update(&ledger, |ledger| {
            ledger.propose(
                "Canopy v3",
                vec![ProposalFile {
                    path: PathBuf::from("/Music/Bounces/Canopy v3.wav"),
                    size: 3000,
                    mtime_ms: 5_000,
                    fingerprint: Some(print.to_string()),
                }],
                0,
            )
        })
        .unwrap();
        Machine {
            _dir: dir,
            ledger,
            id,
        }
    }

    impl Machine {
        fn load(&self) -> Ledger {
            Ledger::load(&self.ledger).unwrap()
        }

        fn reject(&self, never_here: bool) {
            driver::reject(&self.ledger, self.id, never_here).unwrap();
        }
    }

    /// A hub that is not there.
    fn away() -> MockServer {
        MockServer::start(vec![])
    }

    #[test]
    fn a_reject_made_while_the_hub_is_away_is_sent_when_it_is_back() {
        let a = machine("dit:3000:aaa");
        a.reject(true);
        assert_eq!(a.load().unsynced.len(), 2);

        let gone = away();
        // Give the closed server's thread time to drop its listener.
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(flush(&a.ledger, &remote_as(&gone, MACHINE_A)).is_err());
        assert_eq!(
            a.load().unsynced.len(),
            2,
            "what the hub did not take waits"
        );

        let (server, state) = hub();
        flush(&a.ledger, &remote_as(&server, MACHINE_A)).unwrap();

        assert!(a.load().unsynced.is_empty());
        let state = state.lock().unwrap();
        assert_eq!(
            state.files,
            [(
                1,
                "dit:3000:aaa".to_string(),
                Some("Canopy v3.wav".to_string())
            )]
        );
        assert_eq!(
            state.folders,
            [(2, MACHINE_A.to_string(), "/Music/Bounces".to_string())]
        );
        let requests = server.requests();
        assert_eq!(
            requests[0].json(),
            json!({ "items": [
                { "kind": "not-a-bounce", "fingerprint": "dit:3000:aaa", "fileName": "Canopy v3.wav" },
                { "kind": "never-here", "machineId": MACHINE_A, "folder": "/Music/Bounces" },
            ] })
        );
        assert_eq!(requests[0].header("X-Machine-Id"), Some(MACHINE_A));
    }

    #[test]
    fn taking_a_turn_down_back_deletes_it_on_the_hub_and_one_made_and_undone_offline_never_goes() {
        let a = machine("dit:3000:aaa");
        let (server, state) = hub();
        let remote = remote_as(&server, MACHINE_A);
        a.reject(true);
        flush(&a.ledger, &remote).unwrap();

        Ledger::update(&a.ledger, |ledger| {
            ledger.forget_rejected("dit:3000:aaa");
            ledger.forget_never_here(Path::new("/Music/Bounces"));
        })
        .unwrap();
        assert_eq!(a.load().unsynced.len(), 2);
        flush(&a.ledger, &remote).unwrap();

        assert!(a.load().unsynced.is_empty());
        let held = state.lock().unwrap();
        assert!(held.files.is_empty() && held.folders.is_empty());
        drop(held);

        // A turn-down made and taken back before the hub heard needs no request at all.
        let b = machine("dit:3000:bbb");
        b.reject(false);
        Ledger::update(&b.ledger, |ledger| ledger.forget_rejected("dit:3000:bbb")).unwrap();
        assert!(b.load().unsynced.is_empty());
        let before = server.requests().len();
        flush(&b.ledger, &remote).unwrap();
        assert_eq!(server.requests().len(), before);
    }

    #[test]
    fn a_never_here_removal_waits_while_the_connection_names_no_machine() {
        let a = machine("dit:3000:aaa");
        let (server, state) = hub();
        a.reject(true);
        flush(&a.ledger, &remote_as(&server, MACHINE_A)).unwrap();
        Ledger::update(&a.ledger, |ledger| {
            ledger.forget_never_here(Path::new("/Music/Bounces"));
        })
        .unwrap();

        flush(&a.ledger, &remote_to(&server)).unwrap();

        assert_eq!(a.load().unsynced.len(), 1, "the removal is still waiting");
        assert_eq!(
            state.lock().unwrap().folders.len(),
            1,
            "and nothing was deleted"
        );
        flush(&a.ledger, &remote_as(&server, MACHINE_A)).unwrap();
        assert!(a.load().unsynced.is_empty());
        assert!(state.lock().unwrap().folders.is_empty());
    }

    #[test]
    fn a_delete_the_hub_answers_with_404_is_a_removal_done() {
        let a = machine("dit:3000:aaa");
        let (server, _state) = hub();
        a.reject(false);
        flush(&a.ledger, &remote_as(&server, MACHINE_A)).unwrap();
        Ledger::update(&a.ledger, |ledger| ledger.forget_rejected("dit:3000:aaa")).unwrap();
        assert_eq!(a.load().unsynced.len(), 1);

        // The hub lists the file but has lost it by the time of the delete.
        let racing = MockServer::route(|request| {
            match request.method.as_str() {
            "GET" => Reply::json(
                200,
                json!({
                    "notABounce": [{ "id": 1, "fingerprint": "dit:3000:aaa", "fileName": null, "createdAt": "2026-10-21T09:00:00.000Z" }],
                    "neverHere": [],
                })
                .to_string(),
            ),
            _ => Reply::json(404, json!({ "error": "Not found" }).to_string()),
        }
        });

        flush(&a.ledger, &remote_as(&racing, MACHINE_A)).unwrap();

        assert!(a.load().unsynced.is_empty());
    }

    #[test]
    fn a_file_turned_down_on_one_machine_is_not_offered_on_another_and_its_folders_stay_its_own() {
        let a = machine("dit:3000:aaa");
        a.reject(true);
        let (server, _state) = hub();
        flush(&a.ledger, &remote_as(&server, MACHINE_A)).unwrap();

        let b = machine("dit:9999:other");
        assert!(sync(&b.ledger, &remote_as(&server, MACHINE_B)).unwrap());

        let ledger = b.load();
        assert!(ledger.is_rejected("dit:3000:aaa"));
        assert!(ledger.never_here.is_empty());
        assert!(!ledger.is_never_here(Path::new("/Music/Bounces/Canopy v3.wav")));
    }

    #[test]
    fn a_delete_on_the_hub_reaches_the_ledger_on_the_next_sync() {
        let a = machine("dit:3000:aaa");
        a.reject(true);
        let (server, state) = hub();
        let remote = remote_as(&server, MACHINE_A);
        sync(&a.ledger, &remote).unwrap();
        assert!(a.load().is_rejected("dit:3000:aaa"));

        {
            let mut hub = state.lock().unwrap();
            hub.files.clear();
            hub.folders.clear();
        }
        assert!(sync(&a.ledger, &remote).unwrap());

        let ledger = a.load();
        assert!(ledger.rejected.is_empty() && ledger.never_here.is_empty());
    }

    #[test]
    fn the_first_sync_uploads_this_machines_lists_once() {
        let a = machine("dit:3000:aaa");
        // What an older version kept: lists in the ledger, nothing waiting to be sent.
        Ledger::update(&a.ledger, |ledger| {
            ledger.rejected = vec!["dit:3000:aaa".into(), "dit:1:gone".into()];
            ledger.never_here = vec![PathBuf::from("/Music/Old")];
        })
        .unwrap();
        assert!(!a.load().uploaded);
        let (server, state) = hub();
        let remote = remote_as(&server, MACHINE_A);

        sync(&a.ledger, &remote).unwrap();

        assert!(a.load().uploaded);
        {
            let held = state.lock().unwrap();
            let prints: Vec<_> = held
                .files
                .iter()
                .map(|(_, print, _)| print.as_str())
                .collect();
            assert_eq!(prints, ["dit:3000:aaa", "dit:1:gone"]);
            assert_eq!(held.folders.len(), 1);
            assert_eq!(held.posts, 1);
        }
        // The name rides along only for a file a proposal still lists.
        assert_eq!(
            state.lock().unwrap().files[0].2.as_deref(),
            Some("Canopy v3.wav")
        );
        assert_eq!(state.lock().unwrap().files[1].2, None);

        sync(&a.ledger, &remote).unwrap();

        assert_eq!(state.lock().unwrap().posts, 1, "the upload happens once");
    }

    #[test]
    fn a_sync_with_the_hub_away_changes_nothing() {
        let a = machine("dit:3000:aaa");
        a.reject(false);
        let gone = away();
        std::thread::sleep(std::time::Duration::from_millis(50));

        assert!(sync(&a.ledger, &remote_as(&gone, MACHINE_A)).is_err());

        let ledger = a.load();
        assert!(ledger.is_rejected("dit:3000:aaa"));
        assert_eq!(ledger.unsynced.len(), 1);
        assert!(!ledger.uploaded);
    }
}
