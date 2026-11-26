//! What the panel shows of a render: one card per proposal, as the ledger holds it. The app shell sends it to the
//! panel as it is and the cli prints it (`dit renders --json`), so the card is the one shape of a render outside the
//! ledger.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ledger::{Proposal, ProposalState};
pub use super::score::ReasonKinds;

/// Where a render stands, as the panel names it: waiting out its hold, proposed, uploading, queued until the hub is
/// reachable, added, over the producer's size limit, or rejected.
pub use super::ledger::ProposalState as RenderState;

/// One file of a render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFile {
    pub path: std::path::PathBuf,
    /// Its size in bytes.
    pub size: u64,
}

/// How much of the file being uploaded the hub has received.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgress {
    pub sent: u64,
    pub total: u64,
}

/// A render as the panel's card shows it. Emitted as [`crate::DaemonEvent::Render`] on every change of state and,
/// while a file is uploading, about four times a second for its progress.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEvent {
    /// The proposal's id in the ledger, which `dit renders accept` and `reject` take.
    pub id: u64,
    /// The stem the files share.
    pub name: String,
    pub state: RenderState,
    /// Every file of the render: one per format of the bounce.
    pub files: Vec<RenderFile>,
    /// How many renders the one it was proposed with number, when it is part of a batch (an export of stems): the
    /// panel shows "N files".
    pub batch: Option<usize>,
    /// The index in `files` of the one that is (or was) uploaded, once chosen.
    pub uploaded_file: Option<usize>,
    /// What a pair of formats comes to, such as `Mix.wav + Mix.mp3: uploading Mix.wav`; `None` for a single file.
    pub pair_note: Option<String>,
    /// The upload's progress, while the state is [`RenderState::Uploading`].
    pub progress: Option<RenderProgress>,
    /// The confidence it is a version of the session's track, in `[0, 1]`.
    pub score: Option<f64>,
    /// Why, as sentences.
    pub reasons: Vec<String>,
    /// The render's time minus the time of the save nearest it, in milliseconds: positive when the render was
    /// made after the save. `None` when no save time was known.
    pub bounced_after_ms: Option<i64>,
    /// Which kinds of evidence the confidence rests on, as facts for the panel to word (`reasons` is for logs and
    /// the cli).
    pub reason_kinds: ReasonKinds,
    /// The hub's session it is for.
    pub session_id: Option<i64>,
    /// What the state alone does not say: why it is not added yet, or the hub's words.
    pub message: Option<String>,
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

/// What a pair of formats comes to: the files' names and which one goes up, in the tense of the state. `None` for
/// a render of one file.
fn pair_note(proposal: &Proposal) -> Option<String> {
    if proposal.files.len() < 2 {
        return None;
    }
    let names: Vec<String> = proposal
        .files
        .iter()
        .map(|file| file_name(&file.path))
        .collect();
    let all = names.join(" + ");
    let chosen = proposal
        .upload
        .chosen
        .and_then(|index| names.get(index))
        .filter(|_| proposal.state != ProposalState::OverLimit);
    Some(match (proposal.state, chosen) {
        (ProposalState::OverLimit, _) => format!("{all}: none fits the size limit"),
        (_, None) => all,
        (ProposalState::Added, Some(name)) => format!("{all}: uploaded {name}"),
        (ProposalState::Uploading | ProposalState::QueuedOffline, Some(name)) => {
            format!("{all}: uploading {name}")
        }
        (_, Some(name)) => format!("{all}: will upload {name}"),
    })
}

impl RenderEvent {
    /// The card of a proposal.
    pub fn of(proposal: &Proposal) -> Self {
        let progress = (proposal.state == ProposalState::Uploading
            && proposal.upload.total_bytes > 0)
            .then_some(RenderProgress {
                sent: proposal.upload.sent_bytes.min(proposal.upload.total_bytes),
                total: proposal.upload.total_bytes,
            });
        RenderEvent {
            id: proposal.id,
            name: proposal.name.clone(),
            state: proposal.state,
            files: proposal
                .files
                .iter()
                .map(|file| RenderFile {
                    path: file.path.clone(),
                    size: file.size,
                })
                .collect(),
            batch: proposal.batch,
            uploaded_file: proposal.upload.chosen,
            pair_note: pair_note(proposal),
            progress,
            score: proposal.score,
            reasons: proposal.reasons.clone(),
            bounced_after_ms: proposal.bounced_after_ms,
            reason_kinds: proposal.reason_kinds,
            session_id: proposal.session_id,
            message: proposal.message.clone(),
        }
    }
}

/// The cards of a ledger, oldest first: every proposal the producer has not rejected.
pub fn cards(ledger: &super::ledger::Ledger) -> Vec<RenderEvent> {
    ledger
        .proposals
        .iter()
        .filter(|proposal| proposal.state != ProposalState::Rejected)
        .map(RenderEvent::of)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::super::ledger::{Ledger, ProposalFile};
    use super::*;

    fn pair(state: ProposalState) -> Proposal {
        let mut ledger = Ledger::default();
        let file = |name: &str, size| ProposalFile {
            path: PathBuf::from(name),
            size,
            mtime_ms: 0,
            fingerprint: None,
        };
        let id = ledger.propose(
            "Mix",
            vec![file("/b/Mix.mp3", 10), file("/b/Mix.wav", 90)],
            0,
        );
        let proposal = ledger.by_id_mut(id).unwrap();
        proposal.state = state;
        proposal.upload.chosen = Some(1);
        proposal.upload.total_bytes = 90;
        proposal.upload.sent_bytes = 30;
        proposal.clone()
    }

    #[test]
    fn a_pair_names_the_file_that_goes_up_in_the_tense_of_its_state() {
        let note = |state| RenderEvent::of(&pair(state)).pair_note.unwrap();
        assert_eq!(
            note(ProposalState::Uploading),
            "Mix.mp3 + Mix.wav: uploading Mix.wav"
        );
        assert_eq!(
            note(ProposalState::Proposed),
            "Mix.mp3 + Mix.wav: will upload Mix.wav"
        );
        assert_eq!(
            note(ProposalState::Added),
            "Mix.mp3 + Mix.wav: uploaded Mix.wav"
        );
        assert_eq!(
            note(ProposalState::OverLimit),
            "Mix.mp3 + Mix.wav: none fits the size limit"
        );
    }

    #[test]
    fn progress_shows_only_while_uploading() {
        let uploading = RenderEvent::of(&pair(ProposalState::Uploading));
        assert_eq!(
            uploading.progress,
            Some(RenderProgress {
                sent: 30,
                total: 90
            })
        );
        assert_eq!(uploading.uploaded_file, Some(1));
        assert_eq!(
            RenderEvent::of(&pair(ProposalState::Proposed)).progress,
            None
        );
    }

    #[test]
    fn a_card_serialises_in_camel_case_with_kebab_case_states() {
        let value =
            serde_json::to_value(RenderEvent::of(&pair(ProposalState::QueuedOffline))).unwrap();
        assert_eq!(value["state"], "queued-offline");
        assert_eq!(value["uploadedFile"], 1);
        assert!(value["files"][0]["path"].is_string());
        assert!(value["pairNote"].is_string());
    }

    #[test]
    fn a_card_says_what_kind_of_evidence_it_has_and_how_long_after_a_save_it_was_made() {
        let mut proposal = pair(ProposalState::Proposed);
        proposal.score = Some(0.9);
        proposal.reasons = vec!["Named like “Mix”".to_string()];
        proposal.bounced_after_ms = Some(420_000);
        proposal.reason_kinds = ReasonKinds {
            named: true,
            in_folder: false,
            near_save: true,
        };

        let card = RenderEvent::of(&proposal);
        assert_eq!(card.bounced_after_ms, Some(420_000));
        assert_eq!(card.reason_kinds, proposal.reason_kinds);
        assert_eq!(card.reasons, ["Named like “Mix”"]);
        let value = serde_json::to_value(&card).unwrap();
        assert_eq!(value["bouncedAfterMs"], 420_000);
        assert_eq!(
            value["reasonKinds"],
            serde_json::json!({ "named": true, "inFolder": false, "nearSave": true })
        );
        assert_eq!(value["reasons"][0], "Named like “Mix”");

        // A card from a ledger written before these existed reads with no delta and no kinds.
        let old = RenderEvent::of(&pair(ProposalState::Proposed));
        assert_eq!(old.bounced_after_ms, None);
        assert_eq!(old.reason_kinds, ReasonKinds::default());
    }

    #[test]
    fn a_single_file_has_no_pair_note() {
        let mut proposal = pair(ProposalState::Proposed);
        proposal.files.truncate(1);
        assert_eq!(RenderEvent::of(&proposal).pair_note, None);
    }
}
