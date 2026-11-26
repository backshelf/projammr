//! `projammr://` links, which the web's buttons open: "Open in DAW" is `session/<id>` and "Restore" is
//! `dit/checkout/<commit id>`. This module parses a link, finds the set file a hub session id names among the repos
//! dit tracks here, and holds links that arrive before the daemon has caught up on its repos.

use std::path::PathBuf;
use std::sync::Mutex;

use dit_core::{Registry, Repo};
use url::Url;

/// What a link asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    /// Open the set the hub session `id` is, in the DAW.
    Session(i64),
    /// Restore the commit `id` (a hub commit id).
    Checkout(i64),
    /// Anything else: the link as it was received.
    Unknown(String),
}

/// A hub id: a positive whole number in decimal and nothing else.
fn hub_id(segment: &str) -> Option<i64> {
    if segment.is_empty() || !segment.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    segment.parse().ok().filter(|id| *id > 0)
}

/// What `raw` asks for. The segments are the host and then the path (`session/812` and `dit/checkout/41` are each
/// the same whether the link is written `projammr://session/812` or `projammr:///session/812`); a trailing slash,
/// a query and a fragment are ignored.
pub fn parse(raw: &str) -> Link {
    let unknown = || Link::Unknown(raw.trim().to_string());
    let Ok(url) = Url::parse(raw.trim()) else {
        return unknown();
    };
    if url.scheme() != "projammr" {
        return unknown();
    }
    let segments: Vec<&str> = url
        .host_str()
        .into_iter()
        .chain(url.path().split('/'))
        .filter(|segment| !segment.is_empty())
        .collect();
    match segments.as_slice() {
        ["session", id] => hub_id(id).map_or_else(unknown, Link::Session),
        ["dit", "checkout", id] => hub_id(id).map_or_else(unknown, Link::Checkout),
        _ => unknown(),
    }
}

/// The set file of hub session `session` among `repos`: the main file of the set one of them pushed to the
/// instance at `instance` (the origin the sign-in is for) as that session. `None` when no tracked repo did.
pub fn session_file(
    repos: &[PathBuf],
    registry: &Registry,
    instance: &str,
    session: i64,
) -> Option<PathBuf> {
    repos.iter().find_map(|path| {
        let repo = Repo::open(path, registry).ok()?;
        let binding = repo.remote_binding().ok()??;
        if binding.instance != instance {
            return None;
        }
        repo.sets().ok()?.into_iter().find_map(|(set_id, file)| {
            let pushed = repo.pushed_to(&set_id, &binding).ok()??;
            (pushed.session_id == session).then(|| repo.root().join(file))
        })
    })
}

/// Links that reached the app before the daemon finished its launch catch-up. A set file is read and a restore
/// shown against a repo the catch-up may still be recording saves into, so a link waits for it, and every link
/// after the catch-up is handled as it comes.
pub struct Waiting {
    held: Mutex<Option<Vec<Link>>>,
}

impl Default for Waiting {
    /// Holds every link until [`Waiting::release`].
    fn default() -> Self {
        Waiting {
            held: Mutex::new(Some(Vec::new())),
        }
    }
}

impl Waiting {
    fn held(&self) -> std::sync::MutexGuard<'_, Option<Vec<Link>>> {
        self.held.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The link back when it can be handled now; `None` when it was kept for the release.
    pub fn offer(&self, link: Link) -> Option<Link> {
        match &mut *self.held() {
            Some(queue) => {
                queue.push(link);
                None
            }
            None => Some(link),
        }
    }

    /// The links kept, in the order they came; from now on every offer is handed straight back.
    pub fn release(&self) -> Vec<Link> {
        self.held().take().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use dit_core::RemoteBinding;
    use dit_core::repo::PushedSet;

    use super::*;

    #[test]
    fn a_session_link_names_a_hub_session() {
        assert_eq!(parse("projammr://session/812"), Link::Session(812));
        assert_eq!(parse("projammr://session/812/"), Link::Session(812));
        assert_eq!(parse("projammr:///session/812"), Link::Session(812));
        assert_eq!(
            parse("  projammr://session/812?machine=x#y  "),
            Link::Session(812)
        );
        assert_eq!(parse("PROJAMMR://session/7"), Link::Session(7));
    }

    #[test]
    fn a_checkout_link_names_a_commit() {
        assert_eq!(parse("projammr://dit/checkout/41"), Link::Checkout(41));
        assert_eq!(parse("projammr://dit/checkout/41/"), Link::Checkout(41));
        assert_eq!(parse("projammr:///dit/checkout/41?x=1"), Link::Checkout(41));
    }

    #[test]
    fn anything_else_is_unknown_and_keeps_its_words() {
        for raw in [
            "projammr://asset/9",
            "projammr://track/3",
            "projammr://session",
            "projammr://session/abc",
            "projammr://session/-4",
            "projammr://session/0",
            "projammr://session/12/extra",
            "projammr://session/99999999999999999999",
            "projammr://dit/checkout",
            "projammr://dit/checkout/x",
            "projammr://dit/restore/4",
            "projammr://",
            "https://projammr.example/session/812",
            "not a url",
            "",
        ] {
            assert_eq!(parse(raw), Link::Unknown(raw.trim().to_string()), "{raw:?}");
        }
    }

    #[test]
    fn links_wait_for_the_release_in_the_order_they_came_and_then_pass_straight_through() {
        let waiting = Waiting::default();
        assert_eq!(waiting.offer(Link::Session(1)), None);
        assert_eq!(waiting.offer(Link::Checkout(2)), None);

        assert_eq!(waiting.release(), [Link::Session(1), Link::Checkout(2)]);

        assert_eq!(waiting.offer(Link::Session(3)), Some(Link::Session(3)));
        assert_eq!(waiting.release(), Vec::<Link>::new());
    }

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    /// A repo of one fixture set, bound to the hub repo 3 on `instance` and pushed as session `session`.
    fn pushed_project(
        parent: &Path,
        name: &str,
        instance: &str,
        session: i64,
        registry: &Registry,
    ) -> PathBuf {
        let project = parent.join(name);
        fs::create_dir_all(&project).unwrap();
        fs::copy(
            Path::new(FIXTURES).join("Empty Set.als"),
            project.join("Empty Set.als"),
        )
        .unwrap();
        let daw = registry.all()[0];
        let repo = Repo::init(&project, daw).unwrap();
        repo.record_save(&project.join("Empty Set.als")).unwrap();
        repo.bind_remote(&RemoteBinding {
            instance: instance.to_string(),
            repo: 3,
        })
        .unwrap();
        let set_id = repo.sets().unwrap().into_keys().next().unwrap();
        repo.write_pushed(
            &set_id,
            &PushedSet {
                instance: instance.to_string(),
                repo_id: 3,
                session_id: session,
                branches: Default::default(),
            },
        )
        .unwrap();
        repo.root().to_path_buf()
    }

    #[test]
    fn a_session_is_the_set_file_of_the_repo_that_pushed_it_to_this_instance() {
        let registry = dit_daws::registry();
        let dir = tempfile::tempdir().unwrap();
        let ours = pushed_project(
            dir.path(),
            "Ours Project",
            "https://hub.test",
            812,
            &registry,
        );
        let other_hub = pushed_project(
            dir.path(),
            "Theirs Project",
            "https://other.test",
            900,
            &registry,
        );
        let repos = [other_hub, ours.clone()];

        assert_eq!(
            session_file(&repos, &registry, "https://hub.test", 812),
            Some(ours.join("Empty Set.als"))
        );
        assert_eq!(
            session_file(&repos, &registry, "https://hub.test", 900),
            None,
            "pushed to another instance"
        );
        assert_eq!(
            session_file(&repos, &registry, "https://hub.test", 813),
            None,
            "not a session of any tracked repo"
        );
    }

    #[test]
    fn a_repo_that_cannot_be_opened_or_was_never_pushed_is_skipped() {
        let registry = dit_daws::registry();
        let dir = tempfile::tempdir().unwrap();
        let ours = pushed_project(dir.path(), "Ours Project", "https://hub.test", 5, &registry);
        let repos = [dir.path().join("Gone Project"), ours.clone()];
        assert_eq!(
            session_file(&repos, &registry, "https://hub.test", 5),
            Some(ours.join("Empty Set.als"))
        );
        assert_eq!(session_file(&[], &registry, "https://hub.test", 5), None);
    }
}
