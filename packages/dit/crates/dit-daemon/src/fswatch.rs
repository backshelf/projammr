//! The one filesystem watcher: a single notify `RecommendedWatcher` (FSEvents on macOS, inotify on Linux) that
//! fans every event out to subscribers by path prefix.
//!
//! Two recursive streams over overlapping trees would deliver every event twice, so there is only one watcher and
//! it watches the smallest set of roots that covers the subscribers: a subscriber under a root already watched adds
//! nothing, and one above existing roots replaces them. The save watcher subscribes to each repo folder; the render
//! watcher subscribes to the home folder with a filter that drops what it never wants. A subscriber's filter runs on
//! the watcher's own thread before anything is queued, so a busy folder costs a path check, not a channel send.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// One path a filesystem event says changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsEvent {
    pub path: PathBuf,
    /// The path was removed or renamed away: it may not be there when looked at. Not every removal says so, and
    /// a path with `removed` unset may already be gone, so a reader checks the file either way.
    pub removed: bool,
}

type Filter = Box<dyn Fn(&Path) -> bool + Send + Sync>;

struct Subscriber {
    id: u64,
    prefix: PathBuf,
    filter: Filter,
    sender: Sender<FsEvent>,
}

type Subscribers = Arc<Mutex<Vec<Subscriber>>>;

/// Removes the Windows verbatim prefix (`\\?\` or `\\?\UNC\`) that `std::fs::canonicalize`
/// adds, so canonical prefixes match the ordinary paths `notify` emits.
fn strip_verbatim(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Sends one notify event to every subscriber whose prefix holds a path of it and whose filter wants the path.
fn dispatch(subscribers: &Subscribers, event: &notify::Event) {
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    let subscribers = subscribers.lock().unwrap_or_else(|e| e.into_inner());
    for (at, path) in event.paths.iter().enumerate() {
        let normalized = strip_verbatim(path);
        let removed = match event.kind {
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => true,
            // A rename names where the file was and where it went.
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => at == 0,
            _ => false,
        };
        for subscriber in subscribers.iter() {
            if normalized.starts_with(&subscriber.prefix) && (subscriber.filter)(&normalized) {
                let _ = subscriber.sender.send(FsEvent {
                    path: normalized.clone(),
                    removed,
                });
            }
        }
    }
}

pub struct Fswatch {
    watcher: Mutex<RecommendedWatcher>,
    subscribers: Subscribers,
    roots: Mutex<Vec<PathBuf>>,
    next: AtomicU64,
}

/// A subscription; dropping it ends it. The watcher keeps watching the folder, which is cheap and never churns.
pub struct Subscription {
    id: u64,
    subscribers: Subscribers,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.subscribers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|subscriber| subscriber.id != self.id);
    }
}

impl Fswatch {
    pub fn new() -> notify::Result<Fswatch> {
        let subscribers: Subscribers = Arc::default();
        let watcher = {
            let subscribers = subscribers.clone();
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    dispatch(&subscribers, &event);
                }
            })?
        };
        Ok(Fswatch {
            watcher: Mutex::new(watcher),
            subscribers,
            roots: Mutex::default(),
            next: AtomicU64::new(1),
        })
    }

    /// Sends `sender` an [`FsEvent`] for every change under `prefix` that `filter` accepts, watching `prefix`
    /// recursively unless a folder above it already is. `prefix` should be canonical (FSEvents reports real paths).
    pub fn subscribe(
        &self,
        prefix: &Path,
        filter: impl Fn(&Path) -> bool + Send + Sync + 'static,
        sender: Sender<FsEvent>,
    ) -> notify::Result<Subscription> {
        let prefix = strip_verbatim(prefix);
        self.watch(&prefix)?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.subscribers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Subscriber {
                id,
                prefix,
                filter: Box::new(filter),
                sender,
            });
        Ok(Subscription {
            id,
            subscribers: self.subscribers.clone(),
        })
    }

    /// Makes sure `prefix` is covered by a root. Roots below it are unwatched in favour of it, once: this happens
    /// when a wider subscriber arrives, never in a loop.
    fn watch(&self, prefix: &Path) -> notify::Result<()> {
        let mut roots = self.roots.lock().unwrap_or_else(|e| e.into_inner());
        if roots.iter().any(|root| prefix.starts_with(root)) {
            return Ok(());
        }
        let mut watcher = self.watcher.lock().unwrap_or_else(|e| e.into_inner());
        watcher.watch(prefix, RecursiveMode::Recursive)?;
        roots.retain(|root| {
            let covered = root.starts_with(prefix);
            if covered {
                let _ = watcher.unwatch(root);
            }
            !covered
        });
        roots.push(prefix.to_path_buf());
        Ok(())
    }

    /// The folders being watched.
    pub fn roots(&self) -> Vec<PathBuf> {
        self.roots.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use notify::event::{AccessKind, CreateKind, RemoveKind};

    use super::*;

    fn event(kind: EventKind, paths: &[&str]) -> notify::Event {
        let mut event = notify::Event::new(kind);
        for path in paths {
            event = event.add_path(PathBuf::from(path));
        }
        event
    }

    fn subscribe(
        subscribers: &Subscribers,
        id: u64,
        prefix: &str,
        filter: impl Fn(&Path) -> bool + Send + Sync + 'static,
    ) -> mpsc::Receiver<FsEvent> {
        let (sender, receiver) = mpsc::channel();
        subscribers.lock().unwrap().push(Subscriber {
            id,
            prefix: strip_verbatim(Path::new(prefix)),
            filter: Box::new(filter),
            sender,
        });
        receiver
    }

    #[test]
    fn an_event_goes_to_each_subscriber_whose_prefix_holds_it_and_whose_filter_wants_it() {
        let subscribers: Subscribers = Arc::default();
        let repo = subscribe(&subscribers, 1, "/p/A Project", |_| true);
        let home = subscribe(&subscribers, 2, "/p", |path| {
            path.extension().is_some_and(|e| e == "wav")
        });
        let elsewhere = subscribe(&subscribers, 3, "/q", |_| true);

        dispatch(
            &subscribers,
            &event(
                EventKind::Create(CreateKind::File),
                &["/p/A Project/a.als", "/p/A Project/x.wav"],
            ),
        );

        assert_eq!(repo.try_iter().count(), 2);
        let wavs: Vec<_> = home.try_iter().map(|e| e.path).collect();
        assert_eq!(wavs, [PathBuf::from("/p/A Project/x.wav")]);
        assert_eq!(elsewhere.try_iter().count(), 0);
    }

    #[test]
    fn a_prefix_is_a_folder_not_a_string_prefix() {
        let subscribers: Subscribers = Arc::default();
        let repo = subscribe(&subscribers, 1, "/p/A Project", |_| true);
        dispatch(
            &subscribers,
            &event(
                EventKind::Create(CreateKind::File),
                &["/p/A Project 2/a.als"],
            ),
        );
        assert_eq!(repo.try_iter().count(), 0);
    }

    #[test]
    fn removals_and_the_from_side_of_a_rename_are_marked_removed() {
        let subscribers: Subscribers = Arc::default();
        let all = subscribe(&subscribers, 1, "/p", |_| true);
        dispatch(
            &subscribers,
            &event(EventKind::Remove(RemoveKind::File), &["/p/a"]),
        );
        dispatch(
            &subscribers,
            &event(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                &["/p/b"],
            ),
        );
        dispatch(
            &subscribers,
            &event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &["/p/c", "/p/d"],
            ),
        );
        dispatch(
            &subscribers,
            &event(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                &["/p/e"],
            ),
        );

        let seen: Vec<(String, bool)> = all
            .try_iter()
            .map(|e| (e.path.display().to_string(), e.removed))
            .collect();
        assert_eq!(
            seen,
            [
                ("/p/a", true),
                ("/p/b", true),
                ("/p/c", true),
                ("/p/d", false),
                ("/p/e", false)
            ]
            .map(|(p, r)| (p.to_string(), r))
        );
    }

    #[test]
    fn reads_are_not_changes() {
        let subscribers: Subscribers = Arc::default();
        let all = subscribe(&subscribers, 1, "/p", |_| true);
        dispatch(
            &subscribers,
            &event(EventKind::Access(AccessKind::Any), &["/p/a"]),
        );
        assert_eq!(all.try_iter().count(), 0);
    }

    #[test]
    fn dropping_a_subscription_stops_its_events() {
        let subscribers: Subscribers = Arc::default();
        let receiver = subscribe(&subscribers, 7, "/p", |_| true);
        drop(Subscription {
            id: 7,
            subscribers: subscribers.clone(),
        });
        dispatch(
            &subscribers,
            &event(EventKind::Create(CreateKind::File), &["/p/a"]),
        );
        assert_eq!(receiver.try_iter().count(), 0);
    }

    #[test]
    fn windows_verbatim_prefix_matches_ordinary_event_paths() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\C:\Projects\Song Project")),
            PathBuf::from(r"C:\Projects\Song Project")
        );
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\server\share\Song.als")),
            PathBuf::from(r"\\server\share\Song.als")
        );

        let subscribers: Subscribers = Arc::default();
        let repo = subscribe(&subscribers, 1, r"\\?\/p/Song Project", |_| true);
        dispatch(
            &subscribers,
            &event(
                EventKind::Create(CreateKind::File),
                &["/p/Song Project/Song.als"],
            ),
        );
        let events: Vec<_> = repo.try_iter().collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].path, PathBuf::from("/p/Song Project/Song.als"));

        #[cfg(windows)]
        {
            let win_subscribers: Subscribers = Arc::default();
            let win_repo = subscribe(&win_subscribers, 1, r"\\?\C:\Projects\Song Project", |_| {
                true
            });
            dispatch(
                &win_subscribers,
                &event(
                    EventKind::Create(CreateKind::File),
                    &[r"C:\Projects\Song Project\Song.als"],
                ),
            );
            let win_events: Vec<_> = win_repo.try_iter().collect();
            assert_eq!(win_events.len(), 1);
            assert_eq!(
                win_events[0].path,
                PathBuf::from(r"C:\Projects\Song Project\Song.als")
            );
        }
    }
}
