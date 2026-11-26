//! Proposing where each set of a checked folder goes on the hub: the existing session it is the same set as, else a
//! new session on a track.
//!
//! A set matches by the file path a session last recorded, else by a fingerprint it recorded that is the set's or one
//! of its `Backup/` copies'. Only sessions no repo holds are candidates (the hub's read says which), and a session
//! matches at most one set: a second set that would match it is proposed as a new session. A matched session keeps its
//! track. A new session goes on the track of the folder's matched sessions, else on an existing track whose title
//! reads like the folder's name, else on a new track named after the folder without " Project". The producer can
//! change every proposal; the cli takes them as they stand.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use dit_core::remote::{Remote, RemoteError, SetTarget};
use serde::Deserialize;

use super::run::Checked;
use crate::renders::score::{NAMES_A_TRACK, ranked_matches};

/// A session of the project that no repo holds, as the hub's `dit-candidates` read lists it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: i64,
    pub name: String,
    pub track_id: Option<i64>,
    pub track_title: Option<String>,
    /// The path of the set file the session last recorded.
    pub local_filepath: Option<String>,
    /// Every fingerprint the session has recorded.
    #[serde(default)]
    pub fingerprints: Vec<String>,
    /// The time of the session's newest save, as the hub writes it; `None` for a session with none.
    pub last_save_at: Option<String>,
}

/// A track of the project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Track {
    pub id: i64,
    pub title: String,
}

/// What the hub holds that a set could go to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hub {
    pub sessions: Vec<Candidate>,
    /// The project's tracks that are not archived.
    pub tracks: Vec<Track>,
}

/// Reads the project's candidate sessions and its tracks from the hub.
pub fn read(remote: &Remote, project_id: i64) -> Result<Hub, RemoteError> {
    #[derive(Deserialize)]
    struct Candidates {
        sessions: Vec<Candidate>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TrackBody {
        id: i64,
        title: String,
        archived_at: Option<String>,
    }
    let candidates: Candidates =
        remote.get(&format!("/projects/{project_id}/sessions/dit-candidates"))?;
    let tracks: Vec<TrackBody> = remote.get(&format!("/projects/{project_id}/tracks/summary"))?;
    Ok(Hub {
        sessions: candidates.sessions,
        tracks: tracks
            .into_iter()
            .filter(|track| track.archived_at.is_none())
            .map(|track| Track {
                id: track.id,
                title: track.title,
            })
            .collect(),
    })
}

/// How a set came to match a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchedBy {
    /// The session last recorded this file's path.
    Path,
    /// The session recorded the fingerprint of this set or one of its `Backup/` copies.
    Fingerprint,
}

/// The existing session a set was matched to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Matched {
    pub session_id: i64,
    pub name: String,
    pub track_title: Option<String>,
    pub by: MatchedBy,
}

/// Where one set goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proposal {
    pub set_id: String,
    pub target: SetTarget,
    /// The session the set matched; `None` when it is a new session.
    pub matched: Option<Matched>,
}

/// The folder's name without its " Project": the name of the track its new sessions go on.
pub fn track_name(folder: &Path) -> String {
    let name = folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match name.strip_suffix(" Project") {
        Some(stem) if !stem.trim().is_empty() => stem.trim().to_string(),
        _ => name,
    }
}

/// Where each session of `hub` last recorded its set, as recorded and as it resolves now, each path resolved once.
fn recorded_paths(hub: &Hub) -> Vec<Option<(PathBuf, Option<PathBuf>)>> {
    hub.sessions
        .iter()
        .map(|session| {
            session.local_filepath.as_deref().map(|recorded| {
                let recorded = PathBuf::from(recorded);
                let real = recorded.canonicalize().ok();
                (recorded, real)
            })
        })
        .collect()
}

/// Proposes a target for each recorded set of `checked`, in the order of its sets. A set Check could not record has
/// no set id and is left out.
///
/// `taken` holds the ids of the sessions already matched to a set, and a session matches at most one set: the sessions
/// this call matches are added to it, so one `taken` passed for every folder of a run keeps two folders from
/// matching the same session. A set that would match a taken session is proposed as a new session.
pub fn propose(hub: &Hub, checked: &Checked, taken: &mut HashSet<i64>) -> Vec<Proposal> {
    let sets: Vec<_> = checked
        .sets
        .iter()
        .filter(|set| set.set_id.is_some())
        .collect();
    let mut matches: Vec<Option<(usize, MatchedBy)>> = vec![None; sets.len()];
    let paths = recorded_paths(hub);

    for (at, set) in sets.iter().enumerate() {
        let found = hub.sessions.iter().enumerate().find(|(index, session)| {
            !taken.contains(&session.id)
                && paths[*index].as_ref().is_some_and(|(recorded, real)| {
                    recorded == &set.file || real.as_ref() == Some(&set.file)
                })
        });
        if let Some((index, session)) = found {
            taken.insert(session.id);
            matches[at] = Some((index, MatchedBy::Path));
        }
    }
    for (at, set) in sets.iter().enumerate() {
        if matches[at].is_some() {
            continue;
        }
        // The session saved most recently wins among several that recorded the same file; then the lowest id.
        let found = hub
            .sessions
            .iter()
            .enumerate()
            .filter(|(_, session)| {
                !taken.contains(&session.id)
                    && session
                        .fingerprints
                        .iter()
                        .any(|print| set.fingerprints.contains(print))
            })
            .max_by(|(_, a), (_, b)| {
                a.last_save_at
                    .cmp(&b.last_save_at)
                    .then_with(|| b.id.cmp(&a.id))
            });
        if let Some((index, session)) = found {
            taken.insert(session.id);
            matches[at] = Some((index, MatchedBy::Fingerprint));
        }
    }

    let new_track = new_session_track(
        &hub.tracks,
        &checked.path,
        matches
            .iter()
            .flatten()
            .filter_map(|(index, _)| hub.sessions[*index].track_id),
    );
    sets.iter()
        .zip(matches)
        .map(|(set, found)| {
            let set_id = set.set_id.clone().expect("filtered to recorded sets");
            match found {
                Some((index, by)) => {
                    let session = &hub.sessions[index];
                    Proposal {
                        set_id,
                        target: SetTarget::Session(session.id),
                        matched: Some(Matched {
                            session_id: session.id,
                            name: session.name.clone(),
                            track_title: session.track_title.clone(),
                            by,
                        }),
                    }
                }
                None => Proposal {
                    set_id,
                    target: new_track.clone(),
                    matched: None,
                },
            }
        })
        .collect()
}

/// The ids of the tracks a folder's new sessions may go on, best first: the track most of `matched_tracks` (the tracks
/// of the sessions its sets matched) are, the lowest id among equals, then the tracks of `tracks` whose titles read
/// like the folder's name or `set_name`, the most alike first. The one ranking for the backfill and for the panel's
/// first-commit proposal.
pub fn track_ranking(
    tracks: &[Track],
    folder: &Path,
    set_name: Option<&str>,
    matched_tracks: impl IntoIterator<Item = i64>,
) -> Vec<i64> {
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for track in matched_tracks {
        *counts.entry(track).or_default() += 1;
    }
    let mut ranking: Vec<i64> = counts
        .into_iter()
        .max_by(|(a_id, a), (b_id, b)| a.cmp(b).then_with(|| b_id.cmp(a_id)))
        .map(|(id, _)| id)
        .into_iter()
        .collect();
    let titles: Vec<&str> = tracks.iter().map(|track| track.title.as_str()).collect();
    let mut scored: Vec<(usize, f64)> = Vec::new();
    for name in std::iter::once(track_name(folder)).chain(set_name.map(str::to_string)) {
        for (index, score) in ranked_matches(&name, &titles, NAMES_A_TRACK) {
            match scored.iter_mut().find(|(held, _)| *held == index) {
                Some(held) => held.1 = held.1.max(score),
                None => scored.push((index, score)),
            }
        }
    }
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    for (index, _) in scored {
        if !ranking.contains(&tracks[index].id) {
            ranking.push(tracks[index].id);
        }
    }
    ranking
}

/// Where a folder's new sessions go: the first of [`track_ranking`], else a new track named after the folder.
pub fn new_session_track(
    tracks: &[Track],
    folder: &Path,
    matched_tracks: impl IntoIterator<Item = i64>,
) -> SetTarget {
    match track_ranking(tracks, folder, None, matched_tracks).first() {
        Some(id) => SetTarget::Track(*id),
        None => SetTarget::NewTrack(track_name(folder)),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use dit_core::remote::test_support::{MockServer, remote_to};

    use super::super::run::CheckedSet;
    use super::*;

    fn candidate(id: i64, name: &str) -> Candidate {
        Candidate {
            id,
            name: name.to_string(),
            track_id: None,
            track_title: None,
            local_filepath: None,
            fingerprints: Vec::new(),
            last_save_at: None,
        }
    }

    fn set(id: &str, file: &str, prints: &[&str]) -> CheckedSet {
        CheckedSet {
            file: PathBuf::from(file),
            set_id: Some(id.to_string()),
            saves: 1,
            copies: 0,
            fingerprints: prints.iter().map(|print| print.to_string()).collect(),
            doubt: None,
        }
    }

    fn checked(sets: Vec<CheckedSet>) -> Checked {
        Checked {
            path: PathBuf::from("/music/science Project"),
            created_dit: true,
            sets,
            objects: Vec::new(),
            samples: Vec::new(),
            pushes_samples: false,
        }
    }

    fn targets(proposals: &[Proposal]) -> Vec<SetTarget> {
        proposals
            .iter()
            .map(|proposal| proposal.target.clone())
            .collect()
    }

    /// One folder's proposals, with no session matched elsewhere first.
    fn propose(hub: &Hub, checked: &Checked) -> Vec<Proposal> {
        super::propose(hub, checked, &mut HashSet::new())
    }

    #[test]
    fn a_session_matches_one_set_across_folders() {
        let hub = Hub {
            sessions: vec![Candidate {
                fingerprints: vec!["10:aa".into()],
                ..candidate(1, "shared")
            }],
            tracks: Vec::new(),
        };
        let first = checked(vec![set("s1", "/music/a Project/a.als", &["10:aa"])]);
        let second = Checked {
            path: PathBuf::from("/music/b Project"),
            ..checked(vec![set("s2", "/music/b Project/b.als", &["10:aa"])])
        };
        let mut taken = HashSet::new();

        let one = super::propose(&hub, &first, &mut taken);
        let two = super::propose(&hub, &second, &mut taken);

        assert_eq!(targets(&one), [SetTarget::Session(1)]);
        assert_eq!(targets(&two), [SetTarget::NewTrack("b".into())]);
    }

    #[test]
    fn the_path_a_session_recorded_wins_over_a_fingerprint() {
        let by_path = Candidate {
            local_filepath: Some("/music/science Project/science.als".into()),
            ..candidate(1, "science123")
        };
        let by_print = Candidate {
            fingerprints: vec!["10:aa".into()],
            ..candidate(2, "older name")
        };
        let hub = Hub {
            sessions: vec![by_print, by_path],
            tracks: Vec::new(),
        };

        let proposals = propose(
            &hub,
            &checked(vec![set(
                "s1",
                "/music/science Project/science.als",
                &["10:aa"],
            )]),
        );

        assert_eq!(targets(&proposals), [SetTarget::Session(1)]);
        let matched = proposals[0].matched.as_ref().unwrap();
        assert_eq!(
            (matched.name.as_str(), matched.by),
            ("science123", MatchedBy::Path)
        );
    }

    #[test]
    fn a_backup_copys_fingerprint_matches_the_session_that_recorded_it() {
        let hub = Hub {
            sessions: vec![Candidate {
                fingerprints: vec!["10:copy".into()],
                track_id: Some(9),
                track_title: Some("Science".into()),
                ..candidate(5, "science 2019")
            }],
            tracks: Vec::new(),
        };

        let proposals = propose(
            &hub,
            &checked(vec![set(
                "s1",
                "/music/science Project/new.als",
                &["99:set", "10:copy"],
            )]),
        );

        assert_eq!(targets(&proposals), [SetTarget::Session(5)]);
        assert_eq!(
            proposals[0].matched.as_ref().unwrap().by,
            MatchedBy::Fingerprint
        );
    }

    #[test]
    fn a_session_matches_one_set_and_the_other_is_a_new_session() {
        let hub = Hub {
            sessions: vec![Candidate {
                fingerprints: vec!["10:aa".into()],
                track_id: Some(3),
                ..candidate(1, "science")
            }],
            tracks: Vec::new(),
        };

        let proposals = propose(
            &hub,
            &checked(vec![
                set("s1", "/music/science Project/a.als", &["10:aa"]),
                set("s2", "/music/science Project/b.als", &["10:aa"]),
            ]),
        );

        // The second goes on the track the folder's matched session is on.
        assert_eq!(
            targets(&proposals),
            [SetTarget::Session(1), SetTarget::Track(3)]
        );
        assert!(proposals[1].matched.is_none());
    }

    #[test]
    fn among_several_sessions_with_a_fingerprint_the_newest_save_wins() {
        let session = |id, last: &str| Candidate {
            fingerprints: vec!["10:aa".into()],
            last_save_at: Some(last.into()),
            ..candidate(id, "x")
        };
        let hub = Hub {
            sessions: vec![
                session(1, "2019-03-01T00:00:00.000Z"),
                session(2, "2021-03-01T00:00:00.000Z"),
            ],
            tracks: Vec::new(),
        };

        let proposals = propose(
            &hub,
            &checked(vec![set("s1", "/music/science Project/a.als", &["10:aa"])]),
        );

        assert_eq!(targets(&proposals), [SetTarget::Session(2)]);
    }

    #[test]
    fn a_new_session_goes_on_the_track_the_folders_sessions_share_else_a_close_track_else_a_new_one()
     {
        let unmatched = checked(vec![set("s1", "/music/science Project/a.als", &[])]);
        let track = |id, title: &str| Track {
            id,
            title: title.to_string(),
        };

        let close = Hub {
            sessions: Vec::new(),
            tracks: vec![track(1, "Canopy"), track(2, "science")],
        };
        assert_eq!(targets(&propose(&close, &unmatched)), [SetTarget::Track(2)]);

        let none = Hub {
            sessions: Vec::new(),
            tracks: vec![track(1, "Canopy")],
        };
        assert_eq!(
            targets(&propose(&none, &unmatched)),
            [SetTarget::NewTrack("science".into())]
        );

        // A matched session's track beats a title that reads like the folder.
        let shared = Hub {
            sessions: vec![Candidate {
                local_filepath: Some("/music/science Project/b.als".into()),
                track_id: Some(1),
                ..candidate(7, "b")
            }],
            tracks: vec![track(1, "Canopy"), track(2, "science")],
        };
        let both = checked(vec![
            set("s1", "/music/science Project/a.als", &[]),
            set("s2", "/music/science Project/b.als", &[]),
        ]);
        assert_eq!(
            targets(&propose(&shared, &both)),
            [SetTarget::Track(1), SetTarget::Session(7)]
        );
    }

    #[test]
    fn a_set_check_could_not_record_is_left_out() {
        let mut broken = set("x", "/music/science Project/broken.als", &[]);
        broken.set_id = None;
        let proposals = propose(
            &Hub::default(),
            &checked(vec![broken, set("s2", "/music/science Project/b.als", &[])]),
        );

        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].set_id, "s2");
    }

    #[test]
    fn the_track_is_named_after_the_folder_without_its_project() {
        assert_eq!(track_name(Path::new("/m/science Project")), "science");
        assert_eq!(track_name(Path::new("/m/Project")), "Project");
        assert_eq!(track_name(Path::new("/m/odd")), "odd");
    }

    #[test]
    fn the_hub_read_keeps_candidates_and_leaves_out_archived_tracks() {
        let server = MockServer::start(vec![
            (
                200,
                r#"{"sessions":[{"id":4,"name":"science123","trackId":2,"trackTitle":"Science","localFilepath":"/m/a.als","localFileMachineName":"Mac","fingerprints":["10:aa"],"lastSaveAt":"2019-03-01T00:00:00.000Z"},{"id":5,"name":"bare","trackId":null,"trackTitle":null,"localFilepath":null,"localFileMachineName":null,"fingerprints":[],"lastSaveAt":null}]}"#.to_string(),
            ),
            (
                200,
                r#"[{"id":2,"title":"Science","archivedAt":null},{"id":3,"title":"Old","archivedAt":"2020-01-01T00:00:00.000Z"}]"#.to_string(),
            ),
        ]);

        let hub = read(&remote_to(&server), 8).unwrap();

        assert_eq!(hub.sessions.len(), 2);
        assert_eq!(hub.sessions[0].fingerprints, ["10:aa"]);
        assert_eq!(hub.sessions[1].track_id, None);
        assert_eq!(
            hub.tracks,
            [Track {
                id: 2,
                title: "Science".into()
            }]
        );
        let paths: Vec<String> = server
            .requests()
            .iter()
            .map(|request| request.path.clone())
            .collect();
        assert_eq!(
            paths,
            [
                "/api/projects/8/sessions/dit-candidates",
                "/api/projects/8/tracks/summary"
            ]
        );
    }
}
