//! What the runner does with what the daemon reports, on its way to the app: a recorded save is wanted on the hub, a
//! commit is wanted with its lineage, and what the machine has open is kept for the next beat.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use dit_core::remote::Presence;
use dit_core::{Registry, Repo, Signal};

use crate::beat::Beat;
use crate::event::{DaemonEvent, OpenSetInfo};
use crate::queue::{Phase, Queue};

/// The repos the daemon tracks and the set the DAW has open: what a beat reports.
#[derive(Debug, Default)]
pub struct Tracking {
    pub repos: BTreeSet<PathBuf>,
    pub open: Option<OpenSetInfo>,
}

/// What a beat carries, read from the repos as it goes out: the hub ids of the tracked repos pushed to
/// `instance` (the origin the sign-in is for), and the hub session of the set that is open.
///
/// A set counts as open only when the script, the log or the window title says so. The saves signal names the set
/// saved last, which says nothing about a closed DAW, so it is not reported.
pub fn presence(tracking: &Tracking, registry: &Registry, instance: &str) -> Presence {
    let mut repo_ids = BTreeSet::new();
    let mut open_session_id = None;
    for path in &tracking.repos {
        let Ok(repo) = Repo::open(path, registry) else {
            continue;
        };
        let Ok(Some(binding)) = repo.remote_binding() else {
            continue;
        };
        if binding.instance != instance {
            continue;
        }
        repo_ids.insert(binding.repo);
        let Some(open) = tracking
            .open
            .as_ref()
            .filter(|open| open.signal != Signal::Saves && open.repo.as_deref() == Some(path))
        else {
            continue;
        };
        if let Some(set_id) = &open.set_id
            && let Ok(Some(pushed)) = repo.pushed_to(set_id, &binding)
        {
            open_session_id = Some(pushed.session_id);
        }
    }
    Presence {
        open_session_id,
        repo_ids: repo_ids.into_iter().collect(),
    }
}

/// The push queue and the beat the router feeds; empty while the daemon is signed out of the hub.
#[derive(Default)]
pub struct Link {
    pub queue: Option<Arc<Queue>>,
    pub beat: Option<Arc<Beat>>,
}

/// Feeds the push queue and the beat from the daemon's events.
pub struct Router {
    pub link: Arc<Mutex<Link>>,
    pub tracking: Arc<Mutex<Tracking>>,
}

impl Router {
    pub fn route(&self, event: &DaemonEvent) {
        match event {
            DaemonEvent::SaveRecorded { repo, .. } => self.want(repo, Phase::Saves),
            DaemonEvent::Committed { repo, .. } => self.want(repo, Phase::Commits),
            DaemonEvent::RepoTracked { repo } => {
                self.tracking().repos.insert(repo.clone());
                self.want(repo, Phase::Commits);
                self.nudge();
            }
            DaemonEvent::RepoUnreachable { repo, .. } => {
                self.tracking().repos.remove(repo);
                if let Some(queue) = &self.link().queue {
                    queue.forget(repo);
                }
                self.nudge();
            }
            DaemonEvent::OpenSet(open) => {
                self.tracking().open = open.clone();
                self.nudge();
            }
            _ => {}
        }
    }

    fn want(&self, repo: &Path, phase: Phase) {
        if let Some(queue) = &self.link().queue {
            queue.want(repo, phase);
        }
    }

    fn nudge(&self) {
        if let Some(beat) = &self.link().beat {
            beat.beat_now();
        }
    }

    fn link(&self) -> std::sync::MutexGuard<'_, Link> {
        self.link
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn tracking(&self) -> std::sync::MutexGuard<'_, Tracking> {
        self.tracking
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use dit_core::RemoteBinding;
    use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
    use dit_core::repo::PushedSet;
    use serde_json::json;

    use super::*;
    use crate::queue::QueueOptions;
    use crate::test_support::{FakeClock, project, registry, write_set};

    fn bound(
        project_name: &str,
        instance: &str,
        hub_repo: i64,
    ) -> (tempfile::TempDir, PathBuf, Repo, String) {
        let (root, dir, repo) = project(project_name);
        write_set(&dir.join("Song.fset"), "<doc>\n<t/>", 1_000);
        repo.record_save(&dir.join("Song.fset")).unwrap();
        repo.bind_remote(&RemoteBinding {
            instance: instance.to_string(),
            repo: hub_repo,
        })
        .unwrap();
        let set = repo.sets().unwrap().into_keys().next().unwrap();
        repo.write_pushed(
            &set,
            &PushedSet {
                instance: instance.to_string(),
                repo_id: hub_repo,
                session_id: 800 + hub_repo,
                branches: Default::default(),
            },
        )
        .unwrap();
        (root, dir, repo, set)
    }

    fn open(dir: &Path, set: &str, signal: Signal) -> OpenSetInfo {
        OpenSetInfo {
            path: dir.join("Song.fset"),
            signal,
            repo: Some(dir.to_path_buf()),
            set_id: Some(set.to_string()),
            branch: Some("main".to_string()),
        }
    }

    #[test]
    fn a_beat_carries_the_open_sets_session_and_the_hub_ids_of_the_tracked_repos() {
        let (_a, dir_a, _repo_a, set_a) = bound("A", "http://hub.test", 3);
        let (_b, dir_b, _repo_b, _set_b) = bound("B", "http://hub.test", 9);
        let (_c, dir_c, _repo_c, _set_c) = bound("C", "http://other.test", 4);
        let (_d, dir_d, _repo_d) = project("D");
        let tracking = Tracking {
            repos: [dir_a.clone(), dir_b, dir_c, dir_d].into(),
            open: Some(open(&dir_a, &set_a, Signal::Script)),
        };

        let carried = presence(&tracking, &registry(), "http://hub.test");

        assert_eq!(
            carried,
            Presence {
                open_session_id: Some(803),
                repo_ids: vec![3, 9],
            }
        );
    }

    #[test]
    fn a_set_known_only_from_saves_is_not_reported_open() {
        let (_a, dir, _repo, set) = bound("A", "http://hub.test", 3);
        let mut tracking = Tracking {
            repos: [dir.clone()].into(),
            open: Some(open(&dir, &set, Signal::Saves)),
        };
        assert_eq!(
            presence(&tracking, &registry(), "http://hub.test").open_session_id,
            None
        );

        tracking.open = Some(open(&dir, &set, Signal::Title));
        assert_eq!(
            presence(&tracking, &registry(), "http://hub.test").open_session_id,
            Some(803)
        );
        tracking.open = None;
        assert_eq!(
            presence(&tracking, &registry(), "http://hub.test").open_session_id,
            None
        );
    }

    #[test]
    fn a_set_not_pushed_yet_has_no_session_to_report() {
        let (_a, dir, repo, set) = bound("A", "http://hub.test", 3);
        let mut pushed = repo.pushed(&set).unwrap().unwrap();
        pushed.repo_id = 99;
        repo.write_pushed(&set, &pushed).unwrap();
        let tracking = Tracking {
            repos: [dir.clone()].into(),
            open: Some(open(&dir, &set, Signal::Script)),
        };

        let carried = presence(&tracking, &registry(), "http://hub.test");

        assert_eq!(carried.open_session_id, None);
        assert_eq!(carried.repo_ids, [3]);
    }

    #[test]
    fn events_feed_the_queue_and_the_tracking() {
        let server = MockServer::route(|_: &Recorded| Reply::json(200, json!({}).to_string()));
        let clock = FakeClock::default();
        let (events, _heard) = mpsc::channel();
        let queue = Arc::new(Queue::start(
            Arc::new(remote_to(&server)),
            registry(),
            events,
            Arc::new(clock),
            QueueOptions {
                debounce_ms: 3_600_000,
            },
        ));
        let router = Router {
            link: Arc::new(Mutex::new(Link {
                queue: Some(queue.clone()),
                beat: None,
            })),
            tracking: Arc::default(),
        };
        let repo = PathBuf::from("/music/Song Project");
        let other = PathBuf::from("/music/Other Project");

        router.route(&DaemonEvent::RepoTracked { repo: repo.clone() });
        assert_eq!(queue.wanted(), [(repo.clone(), Phase::Commits)]);
        router.route(&DaemonEvent::SaveRecorded {
            repo: other.clone(),
            set_id: "s".into(),
            branch: "main".into(),
            file: "Song.fset".into(),
            save: dit_core::ObjectId::from_bytes([1; 32]),
            at: 0,
            unreadable: false,
            origin: crate::event::Origin::Watch,
        });
        assert_eq!(
            queue.wanted(),
            [
                (other.clone(), Phase::Saves),
                (repo.clone(), Phase::Commits)
            ]
        );
        assert_eq!(router.tracking().repos.len(), 1);

        router.route(&DaemonEvent::RepoUnreachable {
            repo: repo.clone(),
            message: "gone".into(),
        });
        assert_eq!(queue.wanted(), [(other, Phase::Saves)]);
        assert!(router.tracking().repos.is_empty());
    }
}
