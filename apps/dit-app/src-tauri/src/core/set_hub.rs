//! What the app asks the hub of the open set: its session's cover and track, the tracks the set may be (the track
//! proposal on a set's first commit) and the link that makes the track chosen the session's.

use serde::Deserialize;
use serde_json::{Value, json};

use super::*;
use crate::reducer::{HubSet, HubTarget};
use crate::snapshot::{Artwork, TrackChoice};
use dit_daemon::backfill::propose;

/// The `propose_track` value that makes a new track, titled as the proposal said.
const NEW_TRACK: &str = "new";

/// A session, as far as the app reads it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionBody {
    project_id: i64,
    #[serde(default)]
    track: Option<TrackBody>,
    #[serde(default)]
    artwork: Option<ArtworkBody>,
}

#[derive(Deserialize)]
struct TrackBody {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtworkBody {
    asset_path: String,
    accent_hue: Option<f64>,
    accent_chroma: Option<f64>,
}

impl From<ArtworkBody> for Artwork {
    fn from(body: ArtworkBody) -> Self {
        Artwork {
            asset_path: body.asset_path,
            accent_hue: body.accent_hue,
            accent_chroma: body.accent_chroma,
        }
    }
}

/// A track of a project, as the pickers read it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackSummary {
    id: i64,
    title: String,
    #[serde(default)]
    archived_at: Option<String>,
}

/// A track just made.
#[derive(Deserialize)]
struct Created {
    id: i64,
}

/// Whether the open set's facts are being read, and whether another reading was asked for meanwhile.
#[derive(Default)]
pub(super) struct Reading {
    running: bool,
    again: bool,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl Core {
    /// Reads the open set's session from the hub on a thread of its own. A request while a reading runs is not
    /// dropped: it runs again once that one is done, so the set opened last is always the one read last.
    pub(super) fn learn_set(self: &Arc<Self>) {
        {
            let mut reading = lock(&self.reading_set);
            if reading.running {
                reading.again = true;
                return;
            }
            reading.running = true;
        }
        let core = self.clone();
        thread::spawn(move || {
            loop {
                core.read_set();
                let mut reading = lock(&core.reading_set);
                if !std::mem::take(&mut reading.again) {
                    reading.running = false;
                    return;
                }
            }
        });
    }

    /// Asks the hub about the open set, when it is a session there. A hub that cannot be reached leaves what was
    /// known.
    fn read_set(&self) {
        let Some(target) = lock(&self.reducer).hub_target() else {
            return;
        };
        let Ok(remote) = self.remote.open() else {
            return;
        };
        let Ok(session) = remote.get::<SessionBody>(&format!("/sessions/{}", target.session_id))
        else {
            return;
        };
        let choices = if session.track.is_none() && target.wants_track {
            self.track_choices(&remote, session.project_id, &target)
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let facts = HubSet {
            path: target.path,
            session_id: target.session_id,
            project_id: session.project_id,
            has_track: session.track.is_some(),
            artwork: session.artwork.map(Artwork::from),
            choices,
        };
        self.with_reducer(|reducer| reducer.set_hub_set(facts));
    }

    /// The project's tracks that read like the set or its folder, best first.
    fn track_choices(
        &self,
        remote: &remote::Remote,
        project_id: i64,
        target: &HubTarget,
    ) -> Result<Vec<TrackChoice>, String> {
        let summaries: Vec<TrackSummary> = remote
            .get(&format!("/projects/{project_id}/tracks/summary"))
            .map_err(message)?;
        let live: Vec<propose::Track> = summaries
            .into_iter()
            .filter(|track| track.archived_at.is_none())
            .map(|track| propose::Track {
                id: track.id,
                title: track.title,
            })
            .collect();
        Ok(ranked_choices(&live, &target.set_name, &target.folder_name))
    }

    /// The panel's `propose_track`: links the session of the set file at `set` to the hub track `track` (a choice's
    /// id), or to a new one titled as the proposal said when `track` is `new`. A session that has a track by now (it
    /// was linked on the web) keeps it.
    pub fn propose_track(self: &Arc<Self>, set: &str, track: &str) -> Result<(), String> {
        let target = lock(&self.reducer)
            .hub_target()
            .filter(|target| target.path == set)
            .ok_or("That set isn't open any more.")?;
        let track_id = (track != NEW_TRACK)
            .then(|| track.parse::<i64>())
            .transpose()
            .map_err(|_| "That isn't one of the tracks offered.".to_string())?;
        let remote = self.remote.open().map_err(message)?;
        let session: SessionBody = remote
            .get(&format!("/sessions/{}", target.session_id))
            .map_err(message)?;
        if session.track.is_none() {
            let id = match track_id {
                Some(id) => id,
                None => {
                    let made: Created = remote
                        .post(
                            "/tracks",
                            &json!({ "projectId": session.project_id, "title": target.folder_name }),
                        )
                        .map_err(message)?;
                    made.id
                }
            };
            remote
                .patch::<Value>(
                    &format!("/sessions/{}", target.session_id),
                    &json!({ "trackId": id }),
                )
                .map_err(message)?;
        }
        // The proposal is answered at once; the track's cover follows from the reading that comes next.
        self.with_reducer(|reducer| {
            reducer.set_hub_set(HubSet {
                path: target.path,
                session_id: target.session_id,
                project_id: session.project_id,
                has_track: true,
                artwork: session.artwork.map(Artwork::from),
                choices: Vec::new(),
            });
        });
        self.learn_set();
        Ok(())
    }
}

/// The most choices the proposal lists.
const MOST_CHOICES: usize = 5;

/// The tracks of `live` that read like the set or its folder, in the backfill's ranking, at most [`MOST_CHOICES`].
fn ranked_choices(live: &[propose::Track], set_name: &str, folder_name: &str) -> Vec<TrackChoice> {
    propose::track_ranking(live, Path::new(folder_name), Some(set_name), [])
        .into_iter()
        .filter_map(|id| live.iter().find(|track| track.id == id))
        .take(MOST_CHOICES)
        .map(|track| TrackChoice {
            label: track.title.clone(),
            track: track.id.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(titles: &[&str]) -> Vec<propose::Track> {
        titles
            .iter()
            .enumerate()
            .map(|(at, title)| propose::Track {
                id: at as i64 + 1,
                title: (*title).to_string(),
            })
            .collect()
    }

    #[test]
    fn the_panel_offers_several_tracks_best_first_for_the_set_or_its_folder() {
        let tracks = live(&["Science Fiction", "science", "Canopy", "Night Drive"]);
        let choices = ranked_choices(&tracks, "science", "Canopy");
        let labels: Vec<&str> = choices.iter().map(|c| c.label.as_str()).collect();
        assert!(labels.len() >= 2, "{labels:?}");
        assert!(labels[..2].contains(&"Canopy") && labels[..2].contains(&"science"));
        assert!(!labels.contains(&"Night Drive"));
    }

    #[test]
    fn the_panel_offers_at_most_five_tracks() {
        let titles: Vec<String> = (0..8).map(|n| format!("Song {n}")).collect();
        let titles: Vec<&str> = titles.iter().map(String::as_str).collect();
        assert!(ranked_choices(&live(&titles), "Song", "Song").len() <= MOST_CHOICES);
    }

    #[test]
    fn a_session_with_a_track_and_a_cover_is_read_with_the_accent() {
        let body = r##"{"id":812,"projectId":4,"name":"science123","track":{"id":12,"title":"science"},
            "artwork":{"assetPath":"images/9f2c.webp","accentHue":262.5,"accentChroma":0.14},"other":[1]}"##;
        let session: SessionBody = serde_json::from_str(body).unwrap();
        assert_eq!(session.project_id, 4);
        assert!(session.track.is_some());
        let artwork = Artwork::from(session.artwork.unwrap());
        assert_eq!(artwork.asset_path, "images/9f2c.webp");
        assert_eq!(artwork.accent_hue, Some(262.5));
        assert_eq!(artwork.accent_chroma, Some(0.14));
    }

    #[test]
    fn a_session_without_either_is_read_without_them() {
        for body in [
            r#"{"projectId":4,"track":null,"artwork":null}"#,
            r#"{"projectId":4}"#,
        ] {
            let session: SessionBody = serde_json::from_str(body).unwrap();
            assert!(
                session.track.is_none() && session.artwork.is_none(),
                "{body}"
            );
        }
    }

    #[test]
    fn a_cover_whose_accent_is_unknown_is_still_a_cover() {
        let body = r#"{"projectId":4,"artwork":{"assetPath":"a.webp","accentHue":null,"accentChroma":null}}"#;
        let session: SessionBody = serde_json::from_str(body).unwrap();
        let artwork = Artwork::from(session.artwork.unwrap());
        assert_eq!((artwork.accent_hue, artwork.accent_chroma), (None, None));
    }

    #[test]
    fn track_summaries_say_which_tracks_are_archived() {
        let body = r#"[{"id":1,"title":"science","archivedAt":null,"image":null},
            {"id":2,"title":"old","archivedAt":"2026-01-02T03:04:05.000Z"}]"#;
        let summaries: Vec<TrackSummary> = serde_json::from_str(body).unwrap();
        let live: Vec<i64> = summaries
            .iter()
            .filter(|track| track.archived_at.is_none())
            .map(|track| track.id)
            .collect();
        assert_eq!(live, [1]);
        assert_eq!(summaries[1].title, "old");
    }

    #[test]
    fn a_track_just_made_is_read_by_its_id() {
        let made: Created =
            serde_json::from_str(r#"{"id":31,"title":"science","projectId":4}"#).unwrap();
        assert_eq!(made.id, 31);
    }
}
