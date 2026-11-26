//! `dit renders`: the audio renders the dit app found beside the producer's projects, and what the producer says about
//! them.
//!
//! With the dit app running the cli is answered by the app (through the socket), which owns the ledger, the watcher
//! and the hub connection: it lists, accepts (the upload goes on in the app) and rejects. With no app the cli reads
//! and writes the ledger itself: rejecting is a ledger write and accepting uploads the file here, step by step, the
//! way the app's uploader does, so the two cannot disagree about where an upload stands.

use std::path::PathBuf;

use dit_daemon::renders::driver::{self, UploadEnd, run_upload};
use dit_daemon::renders::event::{RenderEvent, cards};
use dit_daemon::renders::ledger::{Ledger, ProposalState};
use dit_daemon::renders::rejections;
use serde::Serialize;

use crate::commands::CliError;
use crate::context::Context;

/// The last line of a list read from the ledger with no app to ask.
pub const STALE_LINE: &str = "The dit app isn't running; this list may be out of date.";

/// The renders, as cards; `--json` prints the array and nothing else.
#[derive(Serialize)]
#[serde(transparent)]
pub struct Listed {
    pub cards: Vec<RenderEvent>,
    /// Read from the ledger because no app answered.
    #[serde(skip)]
    pub stale: bool,
}

/// A render after it was accepted.
#[derive(Serialize)]
#[serde(transparent)]
pub struct Accepted {
    pub card: RenderEvent,
    /// How uploading it here ended; `None` when the app took it and goes on uploading.
    #[serde(skip)]
    pub ended: Option<UploadEnd>,
}

/// A render after it was rejected.
#[derive(Serialize)]
#[serde(transparent)]
pub struct Rejected {
    pub card: RenderEvent,
    #[serde(skip)]
    pub never_here: bool,
}

fn error(message: impl ToString) -> CliError {
    CliError(message.to_string())
}

/// The ledger beside the user config this command was given.
fn ledger_path(cx: &Context) -> Result<PathBuf, CliError> {
    Ok(Ledger::beside(&cx.remote.config_path().map_err(error)?))
}

/// The card of the render `id` as the ledger has it.
fn card_of(path: &std::path::Path, id: u64) -> Result<RenderEvent, CliError> {
    let ledger = Ledger::load(path).map_err(error)?;
    ledger
        .by_id(id)
        .map(RenderEvent::of)
        .ok_or_else(|| error(format!("There is no render {id}.")))
}

/// Every render not rejected: the app's, or the ledger's when no app answers.
pub fn list(cx: &Context) -> Result<Listed, CliError> {
    if let Some(control) = cx.renders {
        return Ok(Listed {
            cards: control.renders(),
            stale: false,
        });
    }
    let ledger = Ledger::load(&ledger_path(cx)?).map_err(error)?;
    Ok(Listed {
        cards: cards(&ledger),
        stale: true,
    })
}

/// Adds the render `id` to the hub as a version of the track of `set_session`, or of the session it is proposed
/// for. The app uploads it in the background; with no app it is uploaded here before the command returns.
pub fn accept(cx: &mut Context, id: u64, set_session: Option<i64>) -> Result<Accepted, CliError> {
    if let Some(control) = cx.renders {
        let card = control.accept_render(id, set_session).map_err(error)?;
        return Ok(Accepted { card, ended: None });
    }
    let path = ledger_path(cx)?;
    let proposal = driver::request_accept(&path, id, set_session).map_err(error)?;
    let remote = match cx.remote.open() {
        Ok(remote) => remote,
        Err(failure) => {
            // The render waits, as one does for a hub that is away: the app adds it when it next runs signed in.
            let message = failure.to_string();
            let _ = Ledger::update(&path, |ledger| {
                if let Some(proposal) = ledger.by_id_mut(id) {
                    proposal.state = ProposalState::QueuedOffline;
                    proposal.message = Some(message.clone());
                }
            });
            return Err(error(format!(
                "{message} {} stays queued; the dit app adds it when it runs signed in.",
                proposal.name
            )));
        }
    };
    let mut said = false;
    let ended = run_upload(&remote, &path, id, &mut |proposal| {
        if !said && proposal.upload.total_bytes > 0 {
            said = true;
            let file = proposal
                .upload
                .chosen
                .and_then(|index| proposal.files.get(index))
                .and_then(|file| file.path.file_name())
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| proposal.name.clone());
            cx.say(format!("Uploading {file}…"));
        }
    });
    Ok(Accepted {
        card: card_of(&path, id)?,
        ended: Some(ended),
    })
}

/// Says the render `id` is not a bounce, and with `never_here` that nothing is to be proposed from its folder. With
/// no app to answer, the ledger is written here and the hub, which is the record of both lists, is told here too:
/// one that cannot be reached (or no sign-in) leaves the change in the ledger for the app's next attach.
pub fn reject(cx: &mut Context, id: u64, never_here: bool) -> Result<Rejected, CliError> {
    let card = match cx.renders {
        Some(control) => control.reject_render(id, never_here).map_err(error)?,
        None => {
            let path = ledger_path(cx)?;
            let proposal = driver::reject(&path, id, never_here).map_err(error)?;
            if let Ok(remote) = cx.remote.open()
                && let Err(failure) = rejections::flush(&path, &remote)
            {
                cx.say(format!(
                    "Saved here; the hub will hear of it when it's back. ({failure})"
                ));
            }
            RenderEvent::of(&proposal)
        }
    };
    Ok(Rejected { card, never_here })
}
