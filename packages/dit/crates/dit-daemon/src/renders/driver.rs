//! Adds a proposed render to the hub, one step at a time, with every step written down in the ledger before the next
//! begins, so a crash or a lost connection resumes where it was and never uploads a file twice.
//!
//! The steps are: look the file's fingerprint up on the hub; upload it when the hub does not hold it; write the
//! asset's id in the ledger; accept the asset as a render of the session. A proposal with an asset id goes straight
//! to the accept, which the hub answers the same when it is repeated, so a crash between the accept and the
//! ledger's `Added` costs one more accept and nothing else.
//!
//! The dit app's uploader and `dit renders accept` (when the app is not running) both call [`run_upload`]; the
//! ledger's lock is what lets them share the file.

use std::path::Path;
use std::time::{Duration, Instant};

use dit_core::remote::{Remote, RemoteError};
use serde::Deserialize;

use super::ledger::{Ledger, Proposal, ProposalState};
use super::probe::fingerprint;
use super::rules::{Candidate, Choice, Render, upload_choice};
use super::upload::{AcceptOutcome, accept, lookup, upload};

/// The sentence a proposal carries when its session has no track to become a version of.
pub const NO_TRACK_MESSAGE: &str = "This session has no track yet";

/// The sentence a proposal carries when none of its files fits the producer's size limit.
pub const OVER_LIMIT_MESSAGE: &str = "Over your size limit";

/// How often an upload writes its progress down and reports it.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// What the hub says about a session that the renders need: the project its assets belong to and its track.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFacts {
    pub project_id: i64,
    pub track_id: Option<i64>,
    /// The track's title, the name a render of the session is expected to carry.
    pub track_title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionBody {
    project_id: i64,
    track: Option<TrackBody>,
}

#[derive(Deserialize)]
struct TrackBody {
    id: i64,
    title: String,
}

/// Reads a session's project and track from the hub.
pub fn session_facts(remote: &Remote, session_id: i64) -> Result<SessionFacts, RemoteError> {
    let session: SessionBody = remote.get(&format!("/sessions/{session_id}"))?;
    Ok(SessionFacts {
        project_id: session.project_id,
        track_id: session.track.as_ref().map(|track| track.id),
        track_title: session.track.map(|track| track.title),
    })
}

#[derive(Deserialize)]
struct CommitBody {
    #[serde(default)]
    saves: Vec<SaveBody>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBody {
    id: i64,
    file_updated_at: String,
}

/// The days from 1970-01-01 to a civil date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// A moment as the hub writes it: a save's `fileUpdatedAt` is a `Date` its JSON answers carry as `Date.toJSON` does,
/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, in UTC with three digits of milliseconds. In milliseconds since the epoch.
fn instant_ms(text: &str) -> Option<i64> {
    let (date, time) = text.split_once('T')?;
    let (clock, fraction) = time.strip_suffix('Z')?.split_once('.')?;
    if fraction.len() != 3 {
        return None;
    }
    let mut date = date.splitn(3, '-');
    let (year, month, day) = (
        date.next()?.parse::<i64>().ok()?,
        date.next()?.parse::<i64>().ok()?,
        date.next()?.parse::<i64>().ok()?,
    );
    let mut clock = clock.splitn(3, ':');
    let (hour, minute, second) = (
        clock.next()?.parse::<i64>().ok()?,
        clock.next()?.parse::<i64>().ok()?,
        clock.next()?.parse::<i64>().ok()?,
    );
    let millis = fraction.parse::<i64>().ok()?;
    Some(
        (days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000
            + millis,
    )
}

/// The hub's save of `session_id` a render finished at `render_mtime_ms` was bounced from: the newest save made at
/// or before it. `None` when the hub names no such save or cannot be asked: a render is never held back for it.
pub fn bounced_from(remote: &Remote, session_id: i64, render_mtime_ms: i64) -> Option<i64> {
    let commits: Vec<CommitBody> = remote
        .get(&format!("/sessions/{session_id}/commits?limit=500"))
        .ok()?;
    commits
        .iter()
        .flat_map(|commit| &commit.saves)
        .filter_map(|save| Some((instant_ms(&save.file_updated_at)?, save.id)))
        .filter(|(at, _)| *at <= render_mtime_ms)
        .max()
        .map(|(_, id)| id)
}

/// How an attempt to add a render ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadEnd {
    /// The render is a version of its session's track.
    Added,
    /// The session has no track yet; the render is proposed again, its file already on the hub.
    NoTrack,
    /// The hub could not be reached or was busy; the render is queued and the attempt is worth repeating.
    Offline { message: String },
    /// The hub no longer accepts the sign-in; nothing more is sent until the producer signs in again.
    SignedOut { host: String },
    /// The hub refused the file (too large, not audio, not this project's); repeating the attempt will not help.
    Refused { message: String },
    /// The attempt could not begin or go on for a reason on this machine (no such render, no session, the file is
    /// gone, the ledger cannot be written).
    Failed { message: String },
}

/// What stopped a step: the hub, or this machine.
enum Stop {
    Hub(RemoteError),
    Local(String),
}

impl From<RemoteError> for Stop {
    fn from(error: RemoteError) -> Self {
        Stop::Hub(error)
    }
}

/// Applies `change` to the proposal `id` in the ledger at `path` and returns the proposal as it is then.
fn update(path: &Path, id: u64, change: impl FnOnce(&mut Proposal)) -> Result<Proposal, String> {
    Ledger::update(path, |ledger| {
        ledger.by_id_mut(id).map(|proposal| {
            change(proposal);
            proposal.clone()
        })
    })
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("There is no render {id}."))
}

/// Where a failure of the hub leaves a render and how the attempt ends.
fn classify(error: RemoteError) -> (ProposalState, String, UploadEnd) {
    let message = error.to_string();
    match error {
        RemoteError::SignedOut { host } => (
            ProposalState::QueuedOffline,
            message,
            UploadEnd::SignedOut { host },
        ),
        RemoteError::Refused { status: 413, .. } => (
            ProposalState::OverLimit,
            message.clone(),
            UploadEnd::Refused { message },
        ),
        RemoteError::Unreachable { .. }
        | RemoteError::TimedOut { .. }
        | RemoteError::Unexpected { .. } => (
            ProposalState::QueuedOffline,
            message.clone(),
            UploadEnd::Offline { message },
        ),
        RemoteError::Refused { status, .. } if status == 408 || status == 429 || status >= 500 => (
            ProposalState::QueuedOffline,
            message.clone(),
            UploadEnd::Offline { message },
        ),
        _ => (
            ProposalState::Proposed,
            message.clone(),
            UploadEnd::Refused { message },
        ),
    }
}

/// The file of `proposal` to upload: the one chosen when it was proposed, else the largest.
fn chosen_index(proposal: &Proposal) -> Option<usize> {
    proposal
        .upload
        .chosen
        .filter(|index| *index < proposal.files.len())
        .or_else(|| {
            let render = Render {
                name: proposal.name.clone(),
                files: proposal
                    .files
                    .iter()
                    .map(|file| Candidate {
                        path: file.path.clone(),
                        size: file.size,
                        mtime_ms: file.mtime_ms,
                    })
                    .collect(),
            };
            match upload_choice(&render, 0) {
                Choice::Upload(index) => Some(index),
                Choice::OverLimit => None,
            }
        })
}

/// Adds the proposal `id` of the ledger at `ledger_path` to the hub as a version of its session's track, resuming
/// at the step the ledger says it reached. `on_change` is called with the proposal after every change of it that
/// was written to the ledger: a new state, and the progress of the upload about four times a second.
///
/// The proposal must have a `session_id` and not be rejected or over the size limit; one already added is
/// [`UploadEnd::Added`] at once. It is [`ProposalState::Uploading`] while this runs and, after, one of
/// [`ProposalState::Added`], [`ProposalState::Proposed`] (the session has no track, or the hub refused the file),
/// [`ProposalState::OverLimit`] (the hub's own size limit) or [`ProposalState::QueuedOffline`] (the hub could not
/// be reached, or the sign-in is gone).
pub fn run_upload(
    remote: &Remote,
    ledger_path: &Path,
    id: u64,
    on_change: &mut dyn FnMut(&Proposal),
) -> UploadEnd {
    let begun = match begin(ledger_path, id) {
        Ok(Ok(proposal)) => proposal,
        Ok(Err(end)) | Err(end) => return end,
    };
    on_change(&begun);
    match steps(remote, ledger_path, id, begun, on_change) {
        Ok(end) => end,
        Err(Stop::Local(message)) => {
            if let Ok(left) = update(ledger_path, id, |proposal| {
                proposal.state = ProposalState::Proposed;
                proposal.message = Some(message.clone());
            }) {
                on_change(&left);
            }
            UploadEnd::Failed { message }
        }
        Err(Stop::Hub(error)) => {
            let (state, message, end) = classify(error);
            if let Ok(left) = update(ledger_path, id, |proposal| {
                proposal.state = state;
                proposal.message = Some(message);
            }) {
                on_change(&left);
            }
            end
        }
    }
}

/// Moves the proposal to [`ProposalState::Uploading`]. `Ok(Err(end))` is a proposal there is nothing to do for,
/// which is added already.
fn begin(path: &Path, id: u64) -> Result<Result<Proposal, UploadEnd>, UploadEnd> {
    let failed = |message: String| UploadEnd::Failed { message };
    let mut before = None;
    let proposal = update(path, id, |proposal| {
        before = Some(proposal.state);
        if matches!(
            proposal.state,
            ProposalState::Waiting
                | ProposalState::Proposed
                | ProposalState::QueuedOffline
                | ProposalState::Uploading
        ) && proposal.session_id.is_some()
        {
            proposal.state = ProposalState::Uploading;
            proposal.message = None;
        }
    })
    .map_err(failed)?;
    match before {
        Some(ProposalState::Added) => Ok(Err(UploadEnd::Added)),
        Some(ProposalState::Rejected) => {
            Err(failed(format!("Render {id} was rejected as not a bounce.")))
        }
        Some(ProposalState::OverLimit) => Err(UploadEnd::Refused {
            message: OVER_LIMIT_MESSAGE.to_string(),
        }),
        _ if proposal.session_id.is_none() => Err(failed(format!(
            "Render {id} has no session yet. Say which one with --set."
        ))),
        _ => Ok(Ok(proposal)),
    }
}

/// Looks the chosen file up, uploads it when the hub lacks it, writes its asset down and accepts it.
fn steps(
    remote: &Remote,
    path: &Path,
    id: u64,
    mut current: Proposal,
    on_change: &mut dyn FnMut(&Proposal),
) -> Result<UploadEnd, Stop> {
    let session_id = current.session_id.expect("begin checked the session");
    if current.upload.asset_id.is_none() {
        let index = chosen_index(&current)
            .ok_or_else(|| Stop::Local("There is no file to upload.".to_string()))?;
        let file_path = current.files[index].path.clone();
        let unreadable =
            |error: std::io::Error| Stop::Local(format!("{}: {error}", file_path.display()));
        let size = std::fs::metadata(&file_path).map_err(unreadable)?.len();
        let print = fingerprint(&file_path).map_err(unreadable)?;
        let facts = session_facts(remote, session_id)?;
        current = update(path, id, |proposal| {
            proposal.upload.chosen = Some(index);
            proposal.upload.total_bytes = size;
            proposal.upload.sent_bytes = 0;
            proposal.files[index].size = size;
            proposal.files[index].fingerprint = Some(print.clone());
            proposal.track_id = facts.track_id.or(proposal.track_id);
        })
        .map_err(Stop::Local)?;
        on_change(&current);

        let asset_id = match lookup(remote, facts.project_id, &print)? {
            Some(asset_id) => asset_id,
            None => {
                let mut last: Option<Instant> = None;
                upload(
                    remote,
                    facts.project_id,
                    &print,
                    &file_path,
                    &mut |sent, total| {
                        let now = Instant::now();
                        let due = sent >= total
                            || last.is_none_or(|last| now.duration_since(last) >= PROGRESS_EVERY);
                        if !due {
                            return;
                        }
                        last = Some(now);
                        if let Ok(written) = update(path, id, |proposal| {
                            proposal.upload.sent_bytes = sent.min(size);
                        }) {
                            on_change(&written);
                        }
                    },
                )?
            }
        };
        current = update(path, id, |proposal| {
            proposal.upload.asset_id = Some(asset_id);
            proposal.upload.sent_bytes = size;
        })
        .map_err(Stop::Local)?;
        on_change(&current);
    }
    let asset_id = current
        .upload
        .asset_id
        .expect("the asset id is written down above or was already");

    let bounced = current.bounced_from_save_id.or_else(|| {
        let mtime = chosen_index(&current)
            .map_or(current.first_seen_ms, |index| current.files[index].mtime_ms);
        bounced_from(remote, session_id, mtime)
    });
    let (end, written) = match accept(remote, session_id, asset_id, bounced)? {
        AcceptOutcome::Accepted { track_id } => (
            UploadEnd::Added,
            update(path, id, |proposal| {
                proposal.state = ProposalState::Added;
                proposal.message = None;
                proposal.bounced_from_save_id = bounced;
                proposal.track_id = track_id.or(proposal.track_id);
            }),
        ),
        AcceptOutcome::NoTrack => (
            UploadEnd::NoTrack,
            update(path, id, |proposal| {
                proposal.state = ProposalState::Proposed;
                proposal.message = Some(NO_TRACK_MESSAGE.to_string());
                proposal.bounced_from_save_id = bounced;
            }),
        ),
    };
    on_change(&written.map_err(Stop::Local)?);
    Ok(end)
}

/// The producer asks for the proposal `id` to be added as a version of the track of `set_session` (the one it is
/// proposed for when `None`). The proposal moves to [`ProposalState::Uploading`], which is what [`run_upload`]
/// resumes and what a crash leaves for the next launch to continue. Returns the proposal as it is then.
///
/// A proposal that is added, rejected, over the size limit or already being uploaded is an error in the sentence
/// the producer reads, as is one with no session to go to.
pub fn request_accept(
    ledger_path: &Path,
    id: u64,
    set_session: Option<i64>,
) -> Result<Proposal, String> {
    Ledger::update(ledger_path, |ledger| {
        let proposal = ledger
            .by_id_mut(id)
            .ok_or_else(|| format!("There is no render {id}."))?;
        match proposal.state {
            ProposalState::Added => return Err(format!("{} is added already.", proposal.name)),
            ProposalState::Rejected => {
                return Err(format!("{} was rejected as not a bounce.", proposal.name));
            }
            ProposalState::OverLimit => {
                return Err(format!(
                    "{}: {OVER_LIMIT_MESSAGE}. Raise the limit to add it.",
                    proposal.name
                ));
            }
            ProposalState::Uploading => {
                return Err(format!("{} is being added already.", proposal.name));
            }
            ProposalState::Waiting | ProposalState::Proposed | ProposalState::QueuedOffline => {}
        }
        if let Some(session) = set_session {
            proposal.session_id = Some(session);
        }
        if proposal.session_id.is_none() {
            return Err(format!(
                "{} has no session yet. Say which one with --set <session id>.",
                proposal.name
            ));
        }
        proposal.state = ProposalState::Uploading;
        proposal.message = None;
        Ok(proposal.clone())
    })
    .map_err(|error| error.to_string())?
}

/// The producer says the proposal `id` is not a bounce: every file of it is remembered by its fingerprint, so the
/// same bytes are never proposed again whatever they are called or wherever they are moved to, and with
/// `never_here` the folders of its files are never looked in again. Returns the proposal as it is then.
pub fn reject(ledger_path: &Path, id: u64, never_here: bool) -> Result<Proposal, String> {
    let held = Ledger::load(ledger_path).map_err(|error| error.to_string())?;
    let proposal = held
        .by_id(id)
        .ok_or_else(|| format!("There is no render {id}."))?;
    match proposal.state {
        ProposalState::Rejected => {
            return Err(format!("{} was rejected already.", proposal.name));
        }
        ProposalState::Added => {
            return Err(format!("{} is added already.", proposal.name));
        }
        ProposalState::Uploading => {
            return Err(format!("{} is being added.", proposal.name));
        }
        ProposalState::Waiting
        | ProposalState::Proposed
        | ProposalState::OverLimit
        | ProposalState::QueuedOffline => {}
    }
    // A file not read yet is read now: the fingerprint is how a rejection outlives a rename.
    let prints: Vec<(std::path::PathBuf, String)> = proposal
        .files
        .iter()
        .filter(|file| file.fingerprint.is_none())
        .filter_map(|file| Some((file.path.clone(), fingerprint(&file.path).ok()?)))
        .collect();
    Ledger::update(ledger_path, |ledger| {
        let proposal = ledger
            .by_id_mut(id)
            .ok_or_else(|| format!("There is no render {id}."))?;
        for file in &mut proposal.files {
            if file.fingerprint.is_none()
                && let Some((_, print)) = prints.iter().find(|(path, _)| *path == file.path)
            {
                file.fingerprint = Some(print.clone());
            }
        }
        ledger.reject(id, never_here);
        Ok(ledger.by_id(id).expect("rejected above").clone())
    })
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use dit_core::remote::test_support::{MockServer, remote_to};

    use super::super::ledger::ProposalFile;
    use super::super::test_hub::hub;
    use super::*;

    struct Setup {
        _dir: tempfile::TempDir,
        ledger: PathBuf,
        file: PathBuf,
        id: u64,
    }

    /// A ledger with one proposal of one file, proposed for session 5.
    fn setup() -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Canopy v3.wav");
        fs::write(&file, vec![7u8; 3000]).unwrap();
        let ledger = dir.path().join("renders.json");
        let id = Ledger::update(&ledger, |ledger| {
            let id = ledger.propose(
                "Canopy v3",
                vec![ProposalFile {
                    path: file.clone(),
                    size: 3000,
                    mtime_ms: 5_000,
                    fingerprint: None,
                }],
                0,
            );
            let proposal = ledger.by_id_mut(id).unwrap();
            proposal.state = ProposalState::Proposed;
            proposal.session_id = Some(5);
            proposal.upload.chosen = Some(0);
            id
        })
        .unwrap();
        Setup {
            _dir: dir,
            ledger,
            file,
            id,
        }
    }

    impl Setup {
        fn proposal(&self) -> Proposal {
            Ledger::load(&self.ledger)
                .unwrap()
                .by_id(self.id)
                .unwrap()
                .clone()
        }

        fn change(&self, change: impl FnOnce(&mut Proposal)) {
            update(&self.ledger, self.id, change).unwrap();
        }

        fn run(&self, remote: &Remote) -> UploadEnd {
            run_upload(remote, &self.ledger, self.id, &mut |_| {})
        }
    }

    #[test]
    fn a_proposal_is_added_with_each_step_written_down() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        let mut seen: Vec<(ProposalState, Option<i64>)> = Vec::new();

        let end = run_upload(&remote, &setup.ledger, setup.id, &mut |proposal| {
            seen.push((proposal.state, proposal.upload.asset_id));
        });

        assert_eq!(end, UploadEnd::Added);
        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (1, 1, 1));
        let added = setup.proposal();
        assert_eq!(added.state, ProposalState::Added);
        assert_eq!(added.upload.asset_id, Some(77));
        assert_eq!(
            added.bounced_from_save_id,
            Some(31),
            "the save before the file's time"
        );
        assert_eq!(added.track_id, Some(9));
        assert_eq!(added.message, None);
        assert!(
            added.files[0]
                .fingerprint
                .as_deref()
                .unwrap()
                .starts_with("dit:3000:")
        );
        assert_eq!(seen.first().unwrap().0, ProposalState::Uploading);
        assert_eq!(seen.last().unwrap().0, ProposalState::Added);
        assert!(
            seen.iter().position(|(_, asset)| asset.is_some()).unwrap() < seen.len() - 1,
            "the asset id is written down before the proposal is added: {seen:?}"
        );
    }

    #[test]
    fn a_crash_before_the_lookup_starts_over() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        setup.change(|proposal| proposal.state = ProposalState::Uploading);

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (1, 1, 1));
    }

    #[test]
    fn a_crash_after_the_upload_before_the_asset_id_is_written_does_not_upload_again() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        // The hub took the file; the ledger never heard.
        let print = fingerprint(&setup.file).unwrap();
        hub.lock().unwrap().assets.insert(print, 41);
        setup.change(|proposal| proposal.state = ProposalState::Uploading);

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (1, 0, 1));
        assert_eq!(setup.proposal().upload.asset_id, Some(41));
    }

    #[test]
    fn a_crash_after_the_asset_id_before_the_accept_goes_straight_to_the_accept() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        setup.change(|proposal| {
            proposal.state = ProposalState::Uploading;
            proposal.upload.asset_id = Some(41);
        });

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (0, 0, 1));
        assert_eq!(setup.proposal().state, ProposalState::Added);
    }

    #[test]
    fn a_crash_after_the_accept_before_added_repeats_the_accept_and_nothing_else() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        assert_eq!(setup.run(&remote), UploadEnd::Added);
        // The accept went through; the ledger was last written before it.
        setup.change(|proposal| proposal.state = ProposalState::Uploading);

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (1, 1, 2));
        assert_eq!(setup.proposal().state, ProposalState::Added);
    }

    #[test]
    fn a_proposal_already_added_is_left_alone() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        setup.change(|proposal| proposal.state = ProposalState::Added);

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (0, 0, 0));
    }

    #[test]
    fn a_hub_that_cannot_be_reached_queues_the_proposal_and_a_retry_keeps_the_upload() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        hub.lock().unwrap().fail = Some(("/renders", 503));

        let end = setup.run(&remote);

        assert!(matches!(end, UploadEnd::Offline { .. }), "{end:?}");
        let queued = setup.proposal();
        assert_eq!(queued.state, ProposalState::QueuedOffline);
        assert_eq!(queued.upload.asset_id, Some(77), "the upload is kept");
        assert!(queued.message.is_some());

        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        // The refused accept is not counted: the hub failed it before taking it.
        assert_eq!((hub.lookups, hub.uploads, hub.accepts), (1, 1, 1));
    }

    #[test]
    fn a_hub_nothing_answers_for_queues_the_proposal() {
        // A server with no replies closes its port at once.
        let server = MockServer::start_replies(Vec::new());
        let remote = remote_to(&server);
        std::thread::sleep(std::time::Duration::from_millis(100));
        let setup = setup();

        let end = setup.run(&remote);

        assert!(matches!(end, UploadEnd::Offline { .. }), "{end:?}");
        assert_eq!(setup.proposal().state, ProposalState::QueuedOffline);
    }

    #[test]
    fn a_session_with_no_track_returns_the_proposal_to_proposed_and_keeps_the_upload() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        hub.lock().unwrap().no_track = true;

        assert_eq!(setup.run(&remote), UploadEnd::NoTrack);

        let held = setup.proposal();
        assert_eq!(held.state, ProposalState::Proposed);
        assert_eq!(held.message.as_deref(), Some(NO_TRACK_MESSAGE));
        assert_eq!(held.upload.asset_id, Some(77));

        hub.lock().unwrap().no_track = false;
        assert_eq!(setup.run(&remote), UploadEnd::Added);

        let hub = hub.lock().unwrap();
        assert_eq!((hub.uploads, hub.accepts), (1, 2));
        assert_eq!(setup.proposal().message, None);
    }

    #[test]
    fn a_refused_sign_in_pauses_and_queues_the_proposal() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        hub.lock().unwrap().fail = Some(("/lookup", 401));

        let end = setup.run(&remote);

        assert!(matches!(end, UploadEnd::SignedOut { .. }), "{end:?}");
        assert_eq!(setup.proposal().state, ProposalState::QueuedOffline);
    }

    #[test]
    fn the_hubs_size_limit_is_an_over_limit_proposal_in_its_words() {
        let (_server, hub, remote) = hub();
        let setup = setup();
        hub.lock().unwrap().fail = Some(("/lookup", 413));

        let end = setup.run(&remote);

        assert!(matches!(end, UploadEnd::Refused { .. }), "{end:?}");
        let held = setup.proposal();
        assert_eq!(held.state, ProposalState::OverLimit);
        assert_eq!(held.message.as_deref(), Some("The hub is busy"));
    }

    #[test]
    fn a_file_that_is_gone_fails_without_asking_the_hub() {
        let (server, _hub, remote) = hub();
        let setup = setup();
        fs::remove_file(&setup.file).unwrap();

        let end = setup.run(&remote);

        assert!(matches!(end, UploadEnd::Failed { .. }), "{end:?}");
        assert_eq!(setup.proposal().state, ProposalState::Proposed);
        assert!(setup.proposal().message.is_some());
        assert!(server.requests().is_empty());
    }

    #[test]
    fn accepting_needs_a_session_and_a_proposal_that_can_still_be_added() {
        let setup = setup();
        setup.change(|proposal| proposal.session_id = None);

        let error = request_accept(&setup.ledger, setup.id, None).unwrap_err();
        assert!(error.contains("--set"), "{error}");

        let accepted = request_accept(&setup.ledger, setup.id, Some(12)).unwrap();
        assert_eq!(accepted.session_id, Some(12));
        assert_eq!(accepted.state, ProposalState::Uploading);

        let error = request_accept(&setup.ledger, setup.id, None).unwrap_err();
        assert!(error.contains("being added"), "{error}");
        let error = request_accept(&setup.ledger, 99, None).unwrap_err();
        assert_eq!(error, "There is no render 99.");

        setup.change(|proposal| proposal.state = ProposalState::OverLimit);
        assert!(
            request_accept(&setup.ledger, setup.id, None)
                .unwrap_err()
                .contains("size limit")
        );
        setup.change(|proposal| proposal.state = ProposalState::Added);
        assert!(
            request_accept(&setup.ledger, setup.id, None)
                .unwrap_err()
                .contains("added already")
        );
    }

    #[test]
    fn rejecting_remembers_the_files_by_fingerprint_and_the_folder_when_asked() {
        let setup = setup();

        let rejected = reject(&setup.ledger, setup.id, true).unwrap();

        assert_eq!(rejected.state, ProposalState::Rejected);
        let ledger = Ledger::load(&setup.ledger).unwrap();
        let print = fingerprint(&setup.file).unwrap();
        assert!(
            ledger.is_rejected(&print),
            "read from the file, which had no fingerprint"
        );
        assert!(ledger.is_never_here(&setup.file));
        assert!(
            reject(&setup.ledger, setup.id, false)
                .unwrap_err()
                .contains("rejected already")
        );
        assert_eq!(
            reject(&setup.ledger, 99, false).unwrap_err(),
            "There is no render 99."
        );
    }

    #[test]
    fn the_hubs_moments_are_read_as_javascript_iso_dates() {
        assert_eq!(instant_ms("1970-01-01T00:00:04.000Z"), Some(4_000));
        assert_eq!(instant_ms("1970-01-01T00:00:04.500Z"), Some(4_500));
        assert_eq!(
            instant_ms("2026-10-21T10:30:00.250Z"),
            Some(1_792_578_600_250)
        );
        // Not what `Date.toJSON` writes.
        assert_eq!(instant_ms("1970-01-01T00:00:04Z"), None);
        assert_eq!(instant_ms("1234"), None);
        assert_eq!(instant_ms("yesterday"), None);
    }

    /// The bodies the real hub answered with (a session with a track, a commit row with its saves), trimmed to the
    /// fields around the ones read.
    #[test]
    fn the_hubs_session_and_commit_bodies_parse_and_dates_match_the_dit_log() {
        let session: SessionBody = serde_json::from_str(
            r#"{"id":1,"name":"Arranged Set","daw":"ableton","projectId":1,"trackId":1,"track":{"id":1,"title":"Arranged Set","artists":[],"priorityId":1,"archivedAt":null}}"#,
        )
        .unwrap();
        assert_eq!(session.project_id, 1);
        assert_eq!(
            session.track.map(|track| (track.id, track.title)),
            Some((1, "Arranged Set".to_string()))
        );
        let unassigned: SessionBody =
            serde_json::from_str(r#"{"id":2,"projectId":1,"track":null}"#).unwrap();
        assert!(unassigned.track.is_none());

        let commits: Vec<CommitBody> = serde_json::from_str(
            r#"[{"id":3,"hash":"6a57","branch":"main","saves":[{"id":3,"sessionId":1,"fileUpdatedAt":"2026-10-21T06:13:09.576Z","source":"dit"}]}]"#,
        )
        .unwrap();
        // The save dit logged at 1792563189576 ms is the hub's `fileUpdatedAt` to the millisecond.
        assert_eq!(
            instant_ms(&commits[0].saves[0].file_updated_at),
            Some(1_792_563_189_576)
        );
    }

    #[test]
    fn no_save_before_the_file_is_no_bounce_source() {
        let (_server, _hub, remote) = hub();
        assert_eq!(bounced_from(&remote, 5, 500), None);
        assert_eq!(bounced_from(&remote, 5, 9_000), Some(32));
        assert_eq!(bounced_from(&remote, 5, 4_000), Some(31));
    }
}
