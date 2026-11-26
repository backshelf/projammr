//! What goes into the daemon and what comes out.

use std::path::PathBuf;

use dit_core::{CommitKind, LogState, ObjectId, Signal};

use crate::fswatch::FsEvent;
use crate::queue::PushEvent;
use crate::renders::RenderEvent;
use crate::script::ScriptEvent;
use crate::title::Window;

/// Everything the daemon reacts to. The worker thread feeds these in; a test feeds them by hand.
#[derive(Debug, Clone)]
pub enum Input {
    /// A path changed under a watched repo.
    Fs(FsEvent),
    /// The Live script said something, or connected, or went away.
    Script(ScriptEvent),
    /// The DAW's log was read (`Daw::log_open_set`).
    LogPolled(LogState),
    /// The window list was read; an empty list is "cannot tell", not "nothing is open".
    WindowsPolled(Vec<Window>),
    /// Time passed: look at what is due. Sent about once a second.
    Tick,
    /// A repo exists that the daemon does not know (the cli's `dit init`): track it.
    AddRepo(PathBuf),
    /// The producer accepted the adopt offer for a project folder: make it a repo and track it.
    Adopt(PathBuf),
    /// The producer declined the adopt offer for a project folder: do not offer it again.
    Decline(PathBuf),
    /// Stop the worker.
    Stop,
}

/// How a recorded save came about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// The watcher saw the file settle.
    Watch,
    /// Found at launch, made while the app was not running.
    CatchUp,
    /// The first saves of a repo the producer just adopted.
    Adopt,
}

/// The set the DAW has open, resolved against the repos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSetInfo {
    pub path: PathBuf,
    pub signal: Signal,
    /// The repo it is in, when dit tracks one there, and the set and branch it is the working file of.
    pub repo: Option<PathBuf>,
    pub set_id: Option<String>,
    pub branch: Option<String>,
}

/// What the app shell reads: everything the panel shows changes through one of these.
#[derive(Debug, Clone)]
pub enum DaemonEvent {
    /// A save was recorded. `file` is relative to the repo; `unreadable` says the file was stored whole, unread.
    SaveRecorded {
        repo: PathBuf,
        set_id: String,
        branch: String,
        file: String,
        save: ObjectId,
        at: i64,
        unreadable: bool,
        origin: Origin,
    },
    /// A checkpoint was committed.
    Committed {
        repo: PathBuf,
        set_id: String,
        branch: String,
        commit: ObjectId,
        kind: CommitKind,
        message: String,
    },
    /// The open set changed (`None`: nothing is open).
    OpenSet(Option<OpenSetInfo>),
    /// Whether the DAW is running changed.
    LiveRunning(bool),
    /// What the Live script said, passed on as it came: the panel's live skyline and the script's state.
    Script(ScriptEvent),
    /// The open set is in a project folder dit does not track, and the producer has not declined it: the adopt
    /// prompt.
    AdoptOffer { folder: PathBuf, set: PathBuf },
    /// A repo is tracked now (launch, `AddRepo` or `Adopt`).
    RepoTracked { repo: PathBuf },
    /// A repo in the list could not be opened (moved, deleted, a drive not mounted).
    RepoUnreachable { repo: PathBuf, message: String },
    /// Another writer has held a repo's lock for over a minute: "waiting for repo". Saves are kept retrying.
    RepoBusy { repo: PathBuf },
    /// A file stayed torn for ten minutes and was left until it changes again.
    GaveUp { repo: PathBuf, file: PathBuf },
    /// Something in a repo failed that retrying will not fix.
    RepoError { repo: PathBuf, message: String },
    /// What the push queue is doing for a repo.
    Push(PushEvent),
    /// The hub refused the stored sign-in: nothing more is sent to `host` until the app signs in again.
    SignedOut { host: String },
    /// The hub refused this machine's beat for a reason waiting does not mend (a name another of the account's
    /// machines has, an id that is another account's), in the hub's words.
    MachineRefused { message: String },
    /// A render's card changed: it was found, proposed, is uploading (its progress about four times a second),
    /// queued for the hub, added, over the size limit or rejected.
    Render(RenderEvent),
    /// The remembered turn-downs were brought in step with the hub's after a hub was attached: the files and
    /// folders listed in the settings may have changed.
    RejectionsSynced,
    /// `Daemon::launch` has finished tracking and catching up every configured repo.
    Launched,
    /// `Daemon::adopt` has finished processing `folder` (whether it succeeded or reported a `RepoError`).
    Adopted { folder: PathBuf },
}
