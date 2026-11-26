use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::test_support::*;
use super::*;
use crate::daw::Registry;
use crate::meta::SetMeta;
use crate::store::{ObjectId, ObjectKind, ObjectRead, decode_tree};

fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .map(|path| if path.is_dir() { count_files(&path) } else { 1 })
        .sum()
}

/// ASCII filler of `len` bytes that starts with an unmasked `id="99"`.
fn blob_of(len: usize) -> String {
    let mut x = 0x1234_5678u32;
    let filler: String = (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            char::from(b'a' + (x >> 24) as u8 % 26)
        })
        .collect();
    format!("id=\"99\"{filler}")
}

#[test]
fn init_refuses_a_folder_the_daw_does_not_recognise() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("Not a project");
    fs::create_dir_all(&dir).unwrap();

    let error = Repo::init(&dir, &TEST_DAW).err().unwrap();

    assert_eq!(error, RepoError::NotAProject(dir.clone()));
    assert!(!dir.join(".dit").exists());
}

#[test]
fn init_creates_the_dit_layout() {
    let (_root, repo) = repo();
    let dit = repo.root().join(".dit");

    for dir in ["objects", "logs", "refs/sets"] {
        assert!(dit.join(dir).is_dir(), "{dir}");
    }
    assert_eq!(
        fs::read_to_string(dit.join("config.toml")).unwrap().trim(),
        "daw = \"test\""
    );
    assert!(repo.sets().unwrap().is_empty());
}

#[test]
fn init_leaves_an_existing_repo_alone() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    repo.record_save(&set_path(&repo)).unwrap();

    let again = Repo::init(repo.root(), &TEST_DAW).unwrap();

    assert_eq!(again.sets().unwrap(), repo.sets().unwrap());
}

#[test]
fn open_finds_dit_in_the_folder_or_its_parent() {
    let (_root, repo) = repo();
    let inner = repo.root().join("Samples");
    fs::create_dir_all(&inner).unwrap();

    for path in [repo.root(), inner.as_path()] {
        let opened = Repo::open(path, &registry()).unwrap();
        assert_eq!(opened.root(), repo.root());
        assert_eq!(opened.daw().id(), "test");
    }
}

#[test]
fn open_refuses_a_folder_without_dit() {
    let root = tempfile::tempdir().unwrap();
    let dir = project(root.path());

    let error = Repo::open(&dir, &registry()).err().unwrap();

    assert_eq!(error, RepoError::NotARepo(dir));
}

#[test]
fn open_names_a_daw_the_registry_does_not_know() {
    let (_root, repo) = repo();
    let others = Registry::new(vec![&OTHER_DAW]).unwrap();

    let error = Repo::open(repo.root(), &others).err().unwrap();

    assert_eq!(error, RepoError::UnknownDaw("test".into()));
    assert!(error.to_string().contains("`test`"));
}

#[test]
fn recording_twice_without_a_change_records_one_save() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));

    let first = repo.record_save(&set_path(&repo)).unwrap();
    let second = repo.record_save(&set_path(&repo)).unwrap();

    assert!(first.is_some());
    assert_eq!(second, None);
    let id = set_id(&repo);
    assert_eq!(repo.log(&id, "main").unwrap(), vec![first.unwrap()]);
    assert_eq!(repo.saves(&id, "main").unwrap().len(), 1);
}

#[test]
fn a_touched_file_with_the_same_xml_records_nothing() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    repo.record_save(&set_path(&repo)).unwrap();

    write_set(&set_path(&repo), &xml(1, 2, "b"));

    assert_eq!(repo.record_save(&set_path(&repo)).unwrap(), None);
}

#[test]
fn a_new_set_gets_a_16_hex_char_id_and_a_relative_slash_path() {
    let (_root, repo) = repo();
    let path = repo.root().join("Sub").join("Song.tset");
    write_set(&path, &xml(1, 2, "b"));

    repo.record_save(&path).unwrap();

    let sets = repo.sets().unwrap();
    let (id, name) = sets.iter().next().unwrap();
    assert_eq!(id.len(), 16);
    assert!(id.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(name, "Sub/Song.tset");
}

#[test]
fn a_changed_document_records_a_second_save_in_the_log() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    let first = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_set(&set_path(&repo), &xml(1, 2, "c"));

    let second = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let id = set_id(&repo);
    assert_eq!(repo.log(&id, "main").unwrap(), vec![first, second]);
    let saves = repo.saves(&id, "main").unwrap();
    assert!(!saves[0].view_only);
    assert!(!saves[1].view_only);
    assert_ne!(saves[0].tree, saves[1].tree);
}

#[test]
fn a_change_only_in_masked_values_records_a_view_only_save() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    let first = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_set(&set_path(&repo), &xml(7, 8, "b"));

    let second = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let first = repo.read_save(&first).unwrap();
    let second = repo.read_save(&second).unwrap();
    assert!(second.view_only);
    assert_eq!(second.tree, first.tree);
    assert_ne!(second.side, first.side);
    assert_ne!(second.xml_hash, first.xml_hash);
    assert!(!first.view_only);
}

#[test]
fn an_unparseable_document_records_an_unreadable_save() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "<broken/>"));

    let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let save = repo.read_save(&id).unwrap();
    assert!(save.unreadable);
    assert_eq!(save.meta, None);
}

#[test]
fn a_parseable_document_records_its_meta() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));

    let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let save = repo.read_save(&id).unwrap();
    assert!(!save.unreadable);
    assert_eq!(save.meta, Some(SetMeta::default()));
    assert!(!save.machine.is_empty());
}

#[test]
fn the_stored_tree_and_side_list_unmask_and_join_to_the_original_xml() {
    let (_root, repo) = repo();
    // Over the 256 KiB inline limit, so the blob leaf is stored chunked.
    let documents = [xml(12, 13, &blob_of(300 * 1024)), xml(40, 41, "small")];
    for document in &documents {
        write_set(&set_path(&repo), document);
        repo.record_save(&set_path(&repo)).unwrap();
    }

    let log = repo.log(&set_id(&repo), "main").unwrap();
    for (save, document) in log.iter().zip(&documents) {
        let save = repo.read_save(save).unwrap();
        assert_eq!(repo.materialise_xml(&save).unwrap(), document.as_bytes());
    }
}

#[test]
fn masked_values_leave_the_stored_leaves_and_go_to_one_side_list() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(12, 13, "id=\"99\""));
    let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    let save = repo.read_save(&id).unwrap();

    let (_, body) = repo.store().get(&save.side.unwrap()).unwrap();
    let side: Vec<String> = serde_json::from_slice(&body).unwrap();

    assert_eq!(side, ["12", "13"]);
    let (_, tree) = repo.store().get(&save.tree.unwrap()).unwrap();
    let leaves: Vec<Vec<u8>> = decode_tree(&tree)
        .unwrap()
        .parts
        .iter()
        .flat_map(|part| &part.leaves)
        .map(|leaf| repo.store().read_leaf(&leaf.object).unwrap())
        .collect();
    assert_eq!(leaves[0], b"<doc>\n");
    assert_eq!(
        leaves[1],
        b"<track id=\"@\" name=\"a\"/>\n<track id=\"@\" name=\"b\"/>\n"
    );
    assert_eq!(leaves[2], b"<blob>id=\"99\"");
}

#[test]
fn a_file_that_does_not_decode_stores_nothing_and_can_be_retried() {
    let (_root, repo) = repo();
    let path = set_path(&repo);
    fs::write(&path, b"half-writ").unwrap();

    let error = repo.record_save(&path).err().unwrap();

    assert!(matches!(error, RepoError::Daw(DawError::Corrupt(_))));
    assert_eq!(count_files(&repo.root().join(".dit/objects")), 0);
    assert!(repo.sets().unwrap().is_empty());
    assert_eq!(count_files(&repo.root().join(".dit/logs")), 0);

    write_set(&path, &xml(1, 2, "b"));
    assert!(repo.record_save(&path).unwrap().is_some());
}

#[test]
fn a_file_outside_the_repo_or_of_another_type_is_not_a_set() {
    let (root, repo) = repo();
    let outside = root.path().join("Song.tset");
    write_set(&outside, &xml(1, 2, "b"));
    let wrong_type = repo.root().join("notes.txt");
    write_set(&wrong_type, &xml(1, 2, "b"));
    let inside_dit = repo.root().join(".dit").join("Song.tset");
    write_set(&inside_dit, &xml(1, 2, "b"));
    let folder = repo.root().join("Folder.tset");
    fs::create_dir_all(&folder).unwrap();

    for path in [outside, wrong_type, inside_dit, folder] {
        let error = repo.record_save(&path).err().unwrap();
        assert!(matches!(error, RepoError::NotASet(_)), "{path:?}: {error}");
    }
    assert!(repo.sets().unwrap().is_empty());
}

#[test]
fn a_set_extension_matches_ignoring_case() {
    let (_root, repo) = repo();
    let path = repo.root().join("Song.TSET");
    write_set(&path, &xml(1, 2, "b"));

    assert!(repo.record_save(&path).unwrap().is_some());
}

#[test]
fn file_updated_at_is_the_mtime_floored_to_milliseconds() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    let file = fs::File::options()
        .write(true)
        .open(set_path(&repo))
        .unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_micros(1_234_567))
        .unwrap();

    let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    assert_eq!(repo.read_save(&id).unwrap().file_updated_at, 1234);
}

#[test]
fn saves_read_in_file_time_order_while_the_log_keeps_recording_order() {
    let (_root, repo) = repo();
    let set_mtime = |seconds: u64| {
        let file = fs::File::options()
            .write(true)
            .open(set_path(&repo))
            .unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(seconds))
            .unwrap();
    };
    write_set(&set_path(&repo), &xml(1, 2, "newer"));
    set_mtime(2000);
    let newer = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_set(&set_path(&repo), &xml(1, 2, "older"));
    set_mtime(1000);
    let older = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let id = set_id(&repo);

    assert_eq!(repo.log(&id, "main").unwrap(), vec![newer, older]);
    let times: Vec<i64> = repo
        .saves(&id, "main")
        .unwrap()
        .iter()
        .map(|save| save.file_updated_at)
        .collect();
    assert_eq!(times, [1_000_000, 2_000_000]);
}

#[test]
fn a_save_serialises_in_camel_case_with_hex_ids() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

    let (kind, body) = repo.store().get(&id).unwrap();

    assert_eq!(kind, ObjectKind::Save);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    for key in [
        "setId",
        "branch",
        "xmlHash",
        "tree",
        "side",
        "fileUpdatedAt",
        "machine",
        "meta",
        "viewOnly",
        "unreadable",
    ] {
        assert!(json.get(key).is_some(), "{key}");
    }
    assert_eq!(json["tree"].as_str().unwrap().len(), 64);
}

#[test]
fn a_branch_ref_round_trips_and_an_unknown_one_is_absent() {
    let (_root, repo) = repo();
    let commit = ObjectId::of(ObjectKind::Commit, b"c");

    assert_eq!(repo.read_ref("abc", "main").unwrap(), None);
    repo.write_ref("abc", "feature x", &commit).unwrap();

    assert_eq!(repo.read_ref("abc", "feature x").unwrap(), Some(commit));
}

#[test]
fn an_unbound_repo_has_no_remote_and_writes_no_remote_table() {
    let (_root, repo) = repo();

    assert_eq!(repo.remote_binding().unwrap(), None);
    let config = fs::read_to_string(repo.root().join(".dit/config.toml")).unwrap();
    assert_eq!(config, "daw = \"test\"\n");
}

#[test]
fn binding_a_remote_keeps_the_daw_and_reads_back_after_reopening() {
    let (_root, repo) = repo();
    let binding = RemoteBinding {
        instance: "https://hub.example".to_string(),
        repo: 7,
    };

    repo.bind_remote(&binding).unwrap();

    let reopened = Repo::open(repo.root(), &registry()).unwrap();
    assert_eq!(reopened.remote_binding().unwrap(), Some(binding));
    let config: toml::Value =
        toml::from_str(&fs::read_to_string(repo.root().join(".dit/config.toml")).unwrap()).unwrap();
    assert_eq!(config["daw"].as_str(), Some("test"));
    assert_eq!(
        config["remote"]["instance"].as_str(),
        Some("https://hub.example")
    );
    assert_eq!(config["remote"]["repo"].as_integer(), Some(7));
}

#[test]
fn pushed_state_is_absent_until_written_then_round_trips_as_camel_case_json() {
    let (_root, repo) = repo();
    let save = ObjectId::of(ObjectKind::Save, b"s");
    let commit = ObjectId::of(ObjectKind::Commit, b"c");
    assert_eq!(repo.pushed("abc").unwrap(), None);

    let pushed = PushedSet {
        instance: "https://hub.example".to_string(),
        repo_id: 7,
        session_id: 42,
        branches: [
            (
                "main".to_string(),
                PushedBranch {
                    commit: Some(commit),
                    saves: vec![save],
                    samples: None,
                    lineage: Some(commit),
                    segments_through: Some(1_700_000_000_000),
                },
            ),
            ("alt".to_string(), PushedBranch::default()),
        ]
        .into(),
    };
    repo.write_pushed("abc", &pushed).unwrap();

    assert_eq!(repo.pushed("abc").unwrap(), Some(pushed));
    let file = repo.root().join(".dit/refs/remote/abc.json");
    let json: serde_json::Value = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "instance": "https://hub.example",
            "repoId": 7,
            "sessionId": 42,
            "branches": {
                "alt": { "commit": null, "saves": [] },
                "main": {
                    "commit": commit.to_string(),
                    "saves": [save.to_string()],
                    "lineage": commit.to_string(),
                    "segmentsThrough": 1_700_000_000_000_i64,
                },
            },
        })
    );
}

#[test]
fn pushed_state_belongs_to_the_hub_repo_it_was_recorded_for() {
    let (_root, repo) = repo();
    let binding = RemoteBinding {
        instance: "https://hub.example".to_string(),
        repo: 7,
    };
    let pushed = PushedSet {
        instance: binding.instance.clone(),
        repo_id: binding.repo,
        session_id: 42,
        branches: Default::default(),
    };
    repo.write_pushed("abc", &pushed).unwrap();

    assert_eq!(repo.pushed_to("abc", &binding).unwrap(), Some(pushed));
    let other_repo = RemoteBinding {
        repo: 8,
        ..binding.clone()
    };
    assert_eq!(repo.pushed_to("abc", &other_repo).unwrap(), None);
    let other_instance = RemoteBinding {
        instance: "https://other.example".to_string(),
        ..binding
    };
    assert_eq!(repo.pushed_to("abc", &other_instance).unwrap(), None);
}

#[test]
fn pushed_state_written_without_a_hub_repo_belongs_to_none() {
    let (_root, repo) = repo();
    let binding = RemoteBinding {
        instance: "https://hub.example".to_string(),
        repo: 7,
    };
    let file = repo.root().join(".dit/refs/remote/abc.json");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, br#"{"sessionId":42,"branches":{}}"#).unwrap();

    assert_eq!(repo.pushed_to("abc", &binding).unwrap(), None);
    assert_eq!(repo.pushed("abc").unwrap().unwrap().session_id, 42);
}

#[test]
fn pushed_state_refuses_a_set_id_that_would_leave_the_folder() {
    let (_root, repo) = repo();

    assert!(matches!(repo.pushed("../x"), Err(RepoError::BadSetId(_))));
}

pub(super) fn read_saves(repo: &Repo, ids: &[ObjectId]) -> Vec<Save> {
    ids.iter().map(|id| repo.read_save(id).unwrap()).collect()
}

/// The saves as `history` folds them: each with its id.
fn folded(repo: &Repo, ids: &[ObjectId]) -> Vec<(ObjectId, Save)> {
    ids.iter().copied().zip(read_saves(repo, ids)).collect()
}

#[test]
fn a_commit_after_a_content_change_names_the_latest_save_and_moves_the_branch() {
    let (_root, repo) = repo();
    let first_save = save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let first = user_commit(&repo, &set, "main", "first");
    save_main(&repo, &xml(1, 2, "c"));
    let latest = save_main(&repo, &xml(1, 2, "d"));

    let second = user_commit(&repo, &set, "main", "second");

    assert_eq!(repo.read_commit(&first).unwrap().save, first_save);
    let commit = repo.read_commit(&second).unwrap();
    assert_eq!(commit.save, latest);
    assert_eq!(commit.parent, Some(first));
    assert_eq!(commit.branch, "main");
    assert_eq!(commit.message, "second");
    assert_eq!(commit.author, "Ada");
    assert_eq!(commit.kind, CommitKind::User);
    assert!(commit.at > 0);
    assert_eq!(repo.read_ref(&set, "main").unwrap(), Some(second));
}

#[test]
fn a_second_commit_with_nothing_changed_is_refused_with_the_previous_message() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let first = user_commit(&repo, &set, "main", "kick pattern");

    let error = repo
        .commit(&set, "main", "again", "Ada", CommitKind::User)
        .unwrap_err();

    assert_eq!(
        error,
        RepoError::NothingToCommit {
            since: "kick pattern".into()
        }
    );
    assert_eq!(error.to_string(), "Nothing to commit since 'kick pattern'.");
    assert_eq!(repo.read_ref(&set, "main").unwrap(), Some(first));
}

#[test]
fn a_view_only_save_since_the_last_commit_is_nothing_to_commit() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first");
    save_main(&repo, &xml(7, 8, "b"));

    let error = repo
        .commit(&set, "main", "again", "Ada", CommitKind::Checkpoint)
        .unwrap_err();

    assert!(matches!(error, RepoError::NothingToCommit { .. }));
}

#[test]
fn a_first_commit_is_allowed_even_when_its_save_is_view_only() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let view_only = save_main(&repo, &xml(7, 8, "b"));
    let set = set_id(&repo);
    assert!(repo.read_save(&view_only).unwrap().view_only);

    let id = user_commit(&repo, &set, "main", "first");

    let commit = repo.read_commit(&id).unwrap();
    assert_eq!(commit.save, view_only);
    assert_eq!(commit.parent, None);
}

#[test]
fn committing_a_branch_with_no_saves_is_refused() {
    let (_root, repo) = repo();

    let error = repo
        .commit("abc", "main", "first", "Ada", CommitKind::User)
        .unwrap_err();

    assert!(matches!(error, RepoError::NoSaves(_)));
    assert_eq!(repo.read_ref("abc", "main").unwrap(), None);
}

#[test]
fn a_commit_serialises_in_camel_case_with_a_lowercase_kind() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let id = repo
        .commit(&set_id(&repo), "main", "m", "dit", CommitKind::Checkpoint)
        .unwrap();

    let (kind, body) = repo.store().get(&id).unwrap();

    assert_eq!(kind, ObjectKind::Commit);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    for key in [
        "setId", "branch", "save", "parent", "message", "author", "kind", "at",
    ] {
        assert!(json.get(key).is_some(), "{key}");
    }
    assert_eq!(json["kind"], "checkpoint");
    assert_eq!(json["parent"], serde_json::Value::Null);
}

#[test]
fn a_bad_branch_name_is_refused_everywhere_a_branch_becomes_a_path() {
    let (_root, repo) = repo();
    let commit = ObjectId::of(ObjectKind::Commit, b"c");
    let long = "x".repeat(65);
    let bad = [
        "",
        ".",
        "..",
        ".hidden",
        " lead",
        "trail.",
        "trail ",
        "a/b",
        "a\\b",
        "a@b",
        "a:b",
        &long,
        "con",
        "CON",
        "Prn",
        "aux",
        "aux ",
        "nul",
        "com1",
        "COM9",
        "lpt1",
        "LPT9",
        "con.take",
        "aux.v2.final",
        "com1 .x",
        "Com1",
        "LPT9.x",
        "com²",
        "Lpt³.take",
    ];

    for name in bad {
        let refused = Err(RepoError::BadBranchName(name.to_string()));
        assert_eq!(
            repo.read_ref("abc", name),
            refused.clone().map(|()| None),
            "{name:?}"
        );
        assert_eq!(repo.write_ref("abc", name, &commit), refused, "{name:?}");
        assert!(matches!(
            repo.log("abc", name),
            Err(RepoError::BadBranchName(_))
        ));
    }
    for name in [
        "main",
        "take 2",
        "v1.2_final-mix",
        "démo",
        "console",
        "com10",
        "64".repeat(32).as_str(),
    ] {
        assert!(repo.read_ref("abc", name).is_ok(), "{name:?}");
    }
}

/// Saves once, commits, and checks the commit out as `name`; returns the set id,
/// the commit and the branch file.
fn branch_from_first_commit(repo: &Repo, name: &str) -> (String, ObjectId, PathBuf) {
    save_main(repo, &xml(1, 2, "b"));
    let set = set_id(repo);
    let commit = user_commit(repo, &set, "main", "first");
    let path = repo.checkout_new_branch(&commit, name).unwrap();
    (set, commit, path)
}

#[test]
fn checkout_writes_a_branch_file_that_decodes_to_the_saves_xml() {
    let (_root, repo) = repo();
    let (set, commit, path) = branch_from_first_commit(&repo, "take2");

    assert_eq!(path, repo.root().join("Song @take2.tset"));
    let save = repo
        .read_save(&repo.read_commit(&commit).unwrap().save)
        .unwrap();
    let xml = repo.daw().decode(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(hex::encode(Sha256::digest(&xml)), save.xml_hash.unwrap());
    assert_eq!(repo.read_ref(&set, "take2").unwrap(), Some(commit));
    assert_eq!(
        repo.branch_files(&set)
            .unwrap()
            .get("take2")
            .map(String::as_str),
        Some("Song @take2.tset")
    );
    assert_eq!(repo.sets().unwrap().len(), 1);
    assert!(repo.log(&set, "take2").unwrap().is_empty());
}

#[test]
fn checkout_writes_the_branch_file_beside_a_set_in_a_subfolder() {
    let (_root, repo) = repo();
    let path = repo.root().join("Sub").join("Song.tset");
    write_set(&path, &xml(1, 2, "b"));
    repo.record_save(&path).unwrap();
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");

    let branch = repo.checkout_new_branch(&commit, "alt").unwrap();

    assert_eq!(branch, repo.root().join("Sub").join("Song @alt.tset"));
    assert_eq!(
        repo.branch_files(&set).unwrap()["alt"],
        "Sub/Song @alt.tset"
    );
}

#[test]
fn checkout_refuses_a_branch_name_that_exists() {
    let (_root, repo) = repo();
    let (set, commit, path) = branch_from_first_commit(&repo, "take2");
    let before = fs::read(&path).unwrap();

    let error = repo.checkout_new_branch(&commit, "take2").unwrap_err();

    assert_eq!(error, RepoError::BranchExists("take2".into()));
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(repo.branch_files(&set).unwrap().len(), 1);
}

#[test]
fn checkout_refuses_a_name_that_differs_from_a_branch_only_in_case() {
    let (_root, repo) = repo();
    let (set, commit, _) = branch_from_first_commit(&repo, "take2");

    let error = repo.checkout_new_branch(&commit, "Take2").unwrap_err();

    assert_eq!(error, RepoError::BranchExists("take2".into()));
    assert_eq!(repo.branch_files(&set).unwrap().len(), 1);
}

#[test]
fn a_checkout_that_fails_on_the_ref_leaves_the_name_free_for_a_retry() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");
    let refs = repo.root().join(".dit/refs/sets").join(&set);
    fs::remove_dir_all(&refs).unwrap();
    fs::write(&refs, b"in the way").unwrap();

    assert!(matches!(
        repo.checkout_new_branch(&commit, "take2"),
        Err(RepoError::Io(_))
    ));
    assert!(repo.branch_files(&set).unwrap().is_empty());
    assert!(!repo.root().join("Song @take2.tset").exists());

    fs::remove_file(&refs).unwrap();
    repo.checkout_new_branch(&commit, "take2").unwrap();
    assert_eq!(repo.branch_files(&set).unwrap().len(), 1);
}

#[test]
fn a_set_id_that_is_not_letters_and_digits_is_refused_before_it_becomes_a_path() {
    let (_root, repo) = repo();
    let commit = ObjectId::of(ObjectKind::Commit, b"{}");
    for id in ["../../outside", "a/b", "", "a.b"] {
        let refused = Err(RepoError::BadSetId(id.into()));
        assert_eq!(repo.write_ref(id, "main", &commit), refused, "{id:?}");
        assert_eq!(repo.read_ref(id, "main"), refused.clone().map(|()| None));
        assert_eq!(repo.log(id, "main"), refused.map(|()| Vec::new()));
    }
}

#[test]
fn checkout_never_overwrites_a_file_that_is_already_there() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");
    let existing = repo.root().join("Song @take2.tset");
    fs::write(&existing, b"written by Live").unwrap();

    let error = repo.checkout_new_branch(&commit, "take2").unwrap_err();

    assert_eq!(error, RepoError::BranchFileExists(existing.clone()));
    assert_eq!(fs::read(&existing).unwrap(), b"written by Live");
    assert!(repo.branch_files(&set).unwrap().is_empty());
    assert_eq!(repo.read_ref(&set, "take2").unwrap(), None);
}

#[test]
fn checkout_refuses_a_bad_branch_name_before_writing_anything() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");
    let sets_before = fs::read(repo.root().join(".dit/sets.toml")).unwrap();

    for name in [
        "main", "Main", "MAIN", "a/b", "a@b", "..", "", "trail.", ".hidden", "con", "AUX",
        "nul.take", "com1", "LPT9",
    ] {
        let error = repo.checkout_new_branch(&commit, name).unwrap_err();
        assert_eq!(error, RepoError::BadBranchName(name.into()), "{name:?}");
    }

    assert_eq!(
        fs::read(repo.root().join(".dit/sets.toml")).unwrap(),
        sets_before
    );
    let files: Vec<_> = fs::read_dir(repo.root())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files.len(), 2, "{files:?}");
}

#[test]
fn a_recorded_branch_file_lands_in_its_own_log_under_the_same_set() {
    let (_root, repo) = repo();
    let (set, commit, path) = branch_from_first_commit(&repo, "take2");

    let recorded = repo.record_save(&path).unwrap().unwrap();

    assert_eq!(repo.sets().unwrap().len(), 1);
    assert_eq!(repo.log(&set, "take2").unwrap(), vec![recorded]);
    assert!(
        repo.root()
            .join(".dit/logs")
            .join(&set)
            .join("take2")
            .is_file()
    );
    let save = repo.read_save(&recorded).unwrap();
    assert_eq!(
        (save.set_id.as_str(), save.branch.as_str()),
        (set.as_str(), "take2")
    );
    assert_eq!(repo.log(&set, "main").unwrap().len(), 1);
    assert_eq!(
        repo.read_save(&repo.read_commit(&commit).unwrap().save)
            .unwrap()
            .tree,
        save.tree
    );
    assert_eq!(repo.record_save(&path).unwrap(), None);
}

#[test]
fn a_first_commit_right_after_checkout_is_nothing_to_commit() {
    let (_root, repo) = repo();
    let (set, _, path) = branch_from_first_commit(&repo, "take2");
    repo.record_save(&path).unwrap();

    let error = repo
        .commit(&set, "take2", "again", "Ada", CommitKind::User)
        .unwrap_err();

    assert_eq!(
        error,
        RepoError::NothingToCommit {
            since: "first".into()
        }
    );
}

#[test]
fn a_branch_commit_after_a_change_has_the_source_commit_as_parent() {
    let (_root, repo) = repo();
    let (set, source, path) = branch_from_first_commit(&repo, "take2");
    repo.record_save(&path).unwrap();
    write_set(&path, &xml(1, 2, "changed"));
    repo.record_save(&path).unwrap();

    let id = user_commit(&repo, &set, "take2", "on the branch");

    let commit = repo.read_commit(&id).unwrap();
    assert_eq!(commit.parent, Some(source));
    assert_eq!(commit.branch, "take2");
    assert_eq!(repo.read_ref(&set, "main").unwrap(), Some(source));
}

#[test]
fn history_folds_the_saves_under_the_commit_that_gathered_them() {
    let (_root, repo) = repo();
    let s1 = save_main(&repo, &xml(1, 2, "b"));
    let s2 = save_main(&repo, &xml(1, 2, "c"));
    let set = set_id(&repo);
    let c1 = user_commit(&repo, &set, "main", "one");
    let s3 = save_main(&repo, &xml(1, 2, "d"));
    let s4 = save_main(&repo, &xml(1, 2, "e"));
    let c2 = user_commit(&repo, &set, "main", "two");
    save_main(&repo, &xml(1, 2, "f"));

    let history = repo.history(&set, "main").unwrap();

    let ids: Vec<_> = history.iter().map(|entry| entry.id).collect();
    assert_eq!(ids, [c2, c1]);
    assert_eq!(history[0].saves, folded(&repo, &[s3, s4]));
    assert_eq!(history[1].saves, folded(&repo, &[s1, s2]));
}

#[test]
fn history_of_a_branch_crosses_into_the_commits_it_was_checked_out_from() {
    let (_root, repo) = repo();
    let s1 = save_main(&repo, &xml(1, 2, "b"));
    let s2 = save_main(&repo, &xml(1, 2, "c"));
    let set = set_id(&repo);
    let c1 = user_commit(&repo, &set, "main", "one");
    save_main(&repo, &xml(1, 2, "d"));
    let c2 = user_commit(&repo, &set, "main", "two");
    let path = repo.checkout_new_branch(&c1, "alt").unwrap();
    let a1 = repo.record_save(&path).unwrap().unwrap();
    write_set(&path, &xml(1, 2, "alt change"));
    let a2 = repo.record_save(&path).unwrap().unwrap();
    let alt = user_commit(&repo, &set, "alt", "alt one");

    let history = repo.history(&set, "alt").unwrap();

    let ids: Vec<_> = history.iter().map(|entry| entry.id).collect();
    assert_eq!(ids, [alt, c1]);
    assert!(!ids.contains(&c2));
    assert_eq!(history[0].saves, folded(&repo, &[a1, a2]));
    assert_eq!(history[1].saves, folded(&repo, &[s1, s2]));
    assert_eq!(history[0].commit.branch, "alt");
    assert_eq!(history[1].commit.branch, "main");
    assert_eq!(repo.history(&set, "main").unwrap().len(), 2);
}

#[test]
fn history_of_a_branch_without_commits_is_empty() {
    let (_root, repo) = repo();

    assert!(repo.history("abc", "main").unwrap().is_empty());
}

#[test]
fn sets_toml_keeps_branch_files_apart_from_main_files() {
    let (_root, repo) = repo();
    let (set, _, _) = branch_from_first_commit(&repo, "take 2");

    let text = fs::read_to_string(repo.root().join(".dit/sets.toml")).unwrap();

    assert!(text.contains("[sets]"), "{text}");
    assert!(text.contains(&format!("[branches.{set}]")), "{text}");
    assert_eq!(repo.sets().unwrap()[&set], "Song.tset");
    assert_eq!(
        repo.branch_files(&set).unwrap()["take 2"],
        "Song @take 2.tset"
    );
}

pub(super) fn set_mtime(path: &Path, time: Duration) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(UNIX_EPOCH + time)
        .unwrap();
}

/// Writes `Backup/<name>` beside the set, last modified `seconds` after the
/// epoch, and returns its path.
pub(super) fn write_backup(repo: &Repo, name: &str, document: &str, seconds: u64) -> PathBuf {
    let path = repo.root().join("Backup").join(name);
    write_set(&path, document);
    set_mtime(&path, Duration::from_secs(seconds));
    path
}

/// Records the main file with its mtime at `seconds` and returns the set id and
/// the save.
pub(super) fn save_main_at(repo: &Repo, document: &str, seconds: u64) -> (String, ObjectId) {
    write_set(&set_path(repo), document);
    set_mtime(&set_path(repo), Duration::from_secs(seconds));
    let save = repo.record_save(&set_path(repo)).unwrap().unwrap();
    (set_id(repo), save)
}

pub(super) fn times(repo: &Repo, ids: &[ObjectId]) -> Vec<i64> {
    read_saves(repo, ids)
        .iter()
        .map(|save| save.file_updated_at)
        .collect()
}

#[test]
fn imported_backups_go_before_the_current_save_in_time_order() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "second"), 2000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.skipped.is_empty());
    assert_eq!(report.imported.len(), 2);
    let log = repo.log(&set, "main").unwrap();
    assert_eq!(log, [report.imported[0], report.imported[1], current]);
    assert_eq!(times(&repo, &log), [1_000_000, 2_000_000, 9_000_000]);
    assert_eq!(
        repo.saves(&set, "main").unwrap().pop().unwrap(),
        repo.read_save(&current).unwrap()
    );
}

#[test]
fn an_imported_save_takes_its_time_from_the_mtime_floored_to_milliseconds() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    let path = write_backup(&repo, "Song [a].tset", &xml(1, 2, "old"), 1);
    set_mtime(&path, Duration::from_micros(1_234_567));

    let report = repo.import_backups(&set, "main").unwrap();

    let save = repo.read_save(&report.imported[0]).unwrap();
    assert_eq!(save.file_updated_at, 1234);
    assert_eq!(save.set_id, set);
    assert_eq!(save.branch, "main");
}

#[test]
fn an_imported_save_unmasks_to_the_backups_xml() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup(&repo, "Song [a].tset", &xml(7, 8, "old"), 1000);

    let report = repo.import_backups(&set, "main").unwrap();

    let save = repo.read_save(&report.imported[0]).unwrap();
    assert_eq!(
        repo.materialise_xml(&save).unwrap(),
        xml(7, 8, "old").as_bytes()
    );
}

#[test]
fn importing_twice_records_nothing_the_second_time() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    let a = write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);
    let b = write_backup(&repo, "Song [b].tset", &xml(1, 2, "second"), 2000);
    repo.import_backups(&set, "main").unwrap();
    let log = repo.log(&set, "main").unwrap();

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.imported.is_empty());
    assert_eq!(
        report.skipped,
        [
            (a, "already saved".to_string()),
            (b, "already saved".to_string())
        ]
    );
    assert_eq!(repo.log(&set, "main").unwrap(), log);
}

#[test]
fn a_backup_identical_to_a_live_save_is_skipped() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    let same = write_backup(&repo, "Song [a].tset", &xml(1, 2, "now"), 1000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.imported.is_empty());
    assert_eq!(report.skipped, [(same, "already saved".to_string())]);
    assert_eq!(repo.log(&set, "main").unwrap(), [current]);
}

#[test]
fn two_identical_backups_in_one_import_record_once() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "old"), 1000);
    let dup = write_backup(&repo, "Song [b].tset", &xml(1, 2, "old"), 2000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(report.imported.len(), 1);
    assert_eq!(report.skipped, [(dup, "already saved".to_string())]);
}

#[test]
fn an_imported_save_is_view_only_against_the_save_before_it_in_time() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(9, 9, "b"), 9000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "b"), 1000);
    write_backup(&repo, "Song [b].tset", &xml(5, 6, "b"), 2000);
    write_backup(&repo, "Song [c].tset", &xml(5, 6, "changed"), 3000);
    let before = repo.read_save(&current).unwrap();

    let report = repo.import_backups(&set, "main").unwrap();

    let view_only: Vec<bool> = read_saves(&repo, &report.imported)
        .iter()
        .map(|save| save.view_only)
        .collect();
    assert_eq!(view_only, [false, true, false]);
    assert_eq!(repo.read_save(&current).unwrap(), before);
}

#[test]
fn a_backup_between_two_saves_is_judged_against_the_earlier_one() {
    let (_root, repo) = repo();
    let (set, first) = save_main_at(&repo, &xml(1, 2, "b"), 1000);
    write_set(&set_path(&repo), &xml(1, 2, "c"));
    set_mtime(&set_path(&repo), Duration::from_secs(3000));
    let last = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_backup(&repo, "Song [a].tset", &xml(5, 6, "b"), 2000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(
        repo.log(&set, "main").unwrap(),
        [first, report.imported[0], last]
    );
    assert!(repo.read_save(&report.imported[0]).unwrap().view_only);
}

#[test]
fn unmask_tree_refuses_a_side_list_with_values_left_over() {
    let tree = TEST_DAW.split(xml(1, 2, "b").as_bytes()).unwrap();
    let (masked, mut side) = crate::mask_tree(&TEST_DAW, &tree);
    assert!(!side.is_empty());
    assert_eq!(
        crate::unmask_tree(&TEST_DAW, &masked, &side).unwrap(),
        xml(1, 2, "b").as_bytes()
    );

    side.push("extra".into());
    assert!(matches!(
        crate::unmask_tree(&TEST_DAW, &masked, &side),
        Err(DawError::Malformed(_))
    ));
}

#[test]
fn backups_newer_than_the_latest_save_still_go_before_it() {
    // A project copied without its times: the backups' mtimes are later.
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 5000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "old"), 5001);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "older"), 5002);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(
        repo.log(&set, "main").unwrap(),
        [report.imported[0], report.imported[1], current]
    );
    let head = repo
        .commit(&set, "main", "m", "a", CommitKind::User)
        .unwrap();
    assert_eq!(repo.read_commit(&head).unwrap().save, current);
    assert_eq!(repo.record_save(&set_path(&repo)).unwrap(), None);
}

#[test]
fn recording_the_unchanged_current_file_after_an_import_records_nothing() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "old"), 1000);
    repo.import_backups(&set, "main").unwrap();
    let log = repo.log(&set, "main").unwrap();

    assert_eq!(repo.record_save(&set_path(&repo)).unwrap(), None);
    assert_eq!(repo.log(&set, "main").unwrap(), log);

    let next = save_main(&repo, &xml(1, 2, "newer"));
    let log = repo.log(&set, "main").unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log[1], current);
    assert_eq!(log[2], next);
    assert!(!repo.read_save(&next).unwrap().view_only);
}

#[test]
fn a_commit_made_before_the_import_still_folds_its_saves() {
    let (_root, repo) = repo();
    let (set, s1) = save_main_at(&repo, &xml(1, 2, "b"), 3000);
    let c1 = user_commit(&repo, &set, "main", "one");
    write_set(&set_path(&repo), &xml(1, 2, "c"));
    set_mtime(&set_path(&repo), Duration::from_secs(4000));
    let s2 = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    let c2 = user_commit(&repo, &set, "main", "two");
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "older"), 1000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "old"), 2000);

    let report = repo.import_backups(&set, "main").unwrap();

    let history = repo.history(&set, "main").unwrap();
    let ids: Vec<_> = history.iter().map(|entry| entry.id).collect();
    assert_eq!(ids, [c2, c1]);
    assert_eq!(history[0].saves, folded(&repo, &[s2]));
    let mut first = report.imported.clone();
    first.push(s1);
    assert_eq!(history[1].saves, folded(&repo, &first));
    assert_eq!(repo.read_ref(&set, "main").unwrap(), Some(c2));
}

#[test]
fn a_branch_imports_its_own_files_backups_into_its_own_log() {
    let (_root, repo) = repo();
    let (set, _, path) = branch_from_first_commit(&repo, "alt");
    let alt = repo.record_save(&path).unwrap().unwrap();
    let main_log = repo.log(&set, "main").unwrap();
    write_backup(&repo, "Song @alt [a].tset", &xml(1, 2, "alt old"), 1000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "main old"), 1000);

    let report = repo.import_backups(&set, "alt").unwrap();

    assert_eq!(report.imported.len(), 1);
    let saved = repo.read_save(&report.imported[0]).unwrap();
    assert_eq!(saved.branch, "alt");
    assert_eq!(
        repo.materialise_xml(&saved).unwrap(),
        xml(1, 2, "alt old").as_bytes()
    );
    assert_eq!(repo.log(&set, "alt").unwrap(), [report.imported[0], alt]);
    assert_eq!(repo.log(&set, "main").unwrap(), main_log);
}

#[test]
fn importing_backups_of_a_set_or_branch_the_repo_does_not_know_is_refused() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);

    assert!(matches!(
        repo.import_backups("nope", "main"),
        Err(RepoError::NotASet(_))
    ));
    assert!(matches!(
        repo.import_backups(&set, "alt"),
        Err(RepoError::NotASet(_))
    ));
    assert!(matches!(
        repo.import_backups(&set, "../x"),
        Err(RepoError::BadBranchName(_))
    ));
}

#[test]
fn importing_with_no_backup_folder_records_nothing() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(report, ImportReport::default());
    assert_eq!(repo.log(&set, "main").unwrap(), [current]);
}

/// A second handle on `repo`'s folder, as another process would open it, that
/// gives up on the lock after 50 ms.
fn impatient(repo: &Repo) -> Repo {
    Repo::open(repo.root(), &registry())
        .unwrap()
        .with_lock_wait(Duration::from_millis(50))
}

#[test]
fn every_mutator_gives_up_with_locked_while_another_writer_holds_the_repo() {
    let (_root, repo) = repo();
    let first = save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");
    let other = impatient(&repo);
    let _held = repo.lock().unwrap();

    let results = [
        other.record_save(&set_path(&other)).map(drop),
        other
            .commit(&set, "main", "again", "Ada", CommitKind::User)
            .map(drop),
        other.checkout_new_branch(&commit, "alt").map(drop),
        other.import_backups(&set, "main").map(drop),
        other.write_ref(&set, "main", &first),
        Repo::init_waiting(repo.root(), &TEST_DAW, Duration::from_millis(50)).map(drop),
        other.bind_remote(&RemoteBinding {
            instance: "https://hub.example".to_string(),
            repo: 1,
        }),
        other.write_pushed(&set, &PushedSet::default()),
    ];

    for (index, result) in results.iter().enumerate() {
        assert!(
            matches!(result, Err(RepoError::Locked(_))),
            "mutator {index}: {result:?}"
        );
    }
    let message = results[0].as_ref().unwrap_err().to_string();
    assert!(message.contains("another dit command"), "{message}");
}

#[test]
fn reading_never_waits_for_the_lock() {
    let (_root, repo) = repo();
    let first = save_main(&repo, &xml(1, 2, "b"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first");
    let other = impatient(&repo);
    let _held = repo.lock().unwrap();

    assert_eq!(other.log(&set, "main").unwrap(), [first]);
    assert_eq!(other.saves(&set, "main").unwrap().len(), 1);
    assert_eq!(other.history(&set, "main").unwrap().len(), 1);
    assert_eq!(other.read_ref(&set, "main").unwrap(), Some(commit));
    assert_eq!(other.sets().unwrap().len(), 1);
}

#[test]
fn a_writer_gets_in_once_the_lock_is_released() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "b"));
    let other = impatient(&repo);

    drop(repo.lock().unwrap());

    assert!(other.record_save(&set_path(&other)).unwrap().is_some());
}

#[test]
fn a_failed_write_releases_the_lock() {
    let (_root, repo) = repo();

    assert!(matches!(
        repo.record_save(&repo.root().join("missing.tset")),
        Err(RepoError::Io(_))
    ));

    assert!(impatient(&repo).lock().is_ok());
}

#[test]
fn two_writers_recording_new_sets_never_lose_one() {
    let (_root, repo) = repo();
    let first = Repo::open(repo.root(), &registry()).unwrap();
    let second = Repo::open(repo.root(), &registry()).unwrap();
    let record_all = |writer: &Repo, prefix: &str| {
        for index in 0..8 {
            let path = writer.root().join(format!("{prefix}{index}.tset"));
            write_set(&path, &xml(index, 2, prefix));
            writer.record_save(&path).unwrap().unwrap();
        }
    };

    std::thread::scope(|scope| {
        scope.spawn(|| record_all(&first, "a"));
        scope.spawn(|| record_all(&second, "b"));
    });

    let sets = repo.sets().unwrap();
    assert_eq!(sets.len(), 16, "{sets:?}");
    for set in sets.keys() {
        assert_eq!(repo.log(set, "main").unwrap().len(), 1);
    }
}

mod sample_refs {
    use super::*;
    use crate::meta::SampleKind;
    use crate::repo::test_support::{save_main, set_id};

    fn samples_of(doc_lines: &[&str]) -> (tempfile::TempDir, Vec<crate::meta::SampleRef>) {
        let (root, repo) = repo();
        let doc = format!("<doc>\n{}\n<blob>b", doc_lines.join("\n"));
        save_main(&repo, &doc);
        let saves = repo.saves(&set_id(&repo), "main").unwrap();
        (root, saves[0].samples.clone())
    }

    #[test]
    fn a_save_carries_the_refs_the_set_makes_with_no_object_yet() {
        let (_root, samples) = samples_of(&[
            r#"<sample kind="project" path="/a/Samples/k.wav" rel="Samples/k.wav"/>"#,
            r#"<sample kind="library" path="/lib/s.wav"/>"#,
        ]);
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].kind, SampleKind::Project);
        assert_eq!(samples[0].relative.as_deref(), Some("Samples/k.wav"));
        assert_eq!(samples[1].kind, SampleKind::Library);
        assert!(
            samples
                .iter()
                .all(|s| s.object.is_none() && s.size.is_none())
        );
    }

    #[test]
    fn an_absolute_or_climbing_relative_path_makes_the_ref_outside() {
        let (_root, samples) = samples_of(&[
            r#"<sample kind="project" path="/x" rel="/etc/passwd"/>"#,
            r#"<sample kind="project" path="/y" rel="Samples/../../secret.wav"/>"#,
            r#"<sample kind="project" path="/z" rel="..\secret.wav"/>"#,
        ]);
        assert!(
            samples
                .iter()
                .all(|s| s.kind == SampleKind::Outside && s.relative.is_none())
        );
    }

    #[test]
    fn a_project_ref_outside_samples_keeps_its_kind_and_loses_its_relative_path() {
        let (_root, samples) =
            samples_of(&[r#"<sample kind="project" path="/x" rel="Recorded/a.wav"/>"#]);
        assert_eq!(samples[0].kind, SampleKind::Project);
        assert_eq!(samples[0].relative, None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_leading_out_of_samples_makes_the_ref_outside() {
        let (root, repo) = repo();
        let elsewhere = root.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("k.wav"), b"x").unwrap();
        fs::create_dir_all(repo.root().join("Samples")).unwrap();
        std::os::unix::fs::symlink(&elsewhere, repo.root().join("Samples/link")).unwrap();
        save_main(
            &repo,
            "<doc>\n<sample kind=\"project\" path=\"/x\" rel=\"Samples/link/k.wav\"/>\n<blob>b",
        );
        let saves = repo.saves(&set_id(&repo), "main").unwrap();
        assert_eq!(saves[0].samples[0].kind, SampleKind::Outside);
        assert_eq!(saves[0].samples[0].relative, None);
    }

    #[test]
    fn a_set_without_refs_keeps_the_save_json_it_always_had() {
        let (_root, repo) = repo();
        let id = save_main(&repo, &xml(1, 2, "b"));
        let json = serde_json::to_string(&repo.read_save(&id).unwrap()).unwrap();
        assert!(!json.contains("samples"));
    }
}

mod sample_tracking {
    use super::*;
    use crate::meta::SampleKind;
    use crate::store::LEAF_INLINE_MAX;

    fn with_sample(rel: &str, tail: &str) -> String {
        format!("<doc>\n<sample kind=\"project\" path=\"/p/{rel}\" rel=\"{rel}\"/>\n<blob>{tail}")
    }

    fn write_sample(repo: &Repo, rel: &str, bytes: &[u8]) -> PathBuf {
        let path = repo.root().join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn only_sample(repo: &Repo, save: &ObjectId) -> crate::meta::SampleRef {
        let mut samples = repo.read_save(save).unwrap().samples;
        assert_eq!(samples.len(), 1);
        samples.remove(0)
    }

    fn bytes_of(len: usize) -> Vec<u8> {
        blob_of(len).into_bytes()
    }

    #[test]
    fn a_small_sample_becomes_one_blob_with_its_size() {
        let (_root, repo) = repo();
        write_sample(&repo, "Samples/k.wav", b"kick");
        let save = save_main(&repo, &with_sample("Samples/k.wav", "1"));
        let sample = only_sample(&repo, &save);
        assert_eq!(sample.object, Some(ObjectId::of(ObjectKind::Blob, b"kick")));
        assert_eq!(sample.size, Some(4));
        assert_eq!(
            repo.store().read_leaf(&sample.object.unwrap()).unwrap(),
            b"kick"
        );
    }

    #[test]
    fn a_large_sample_becomes_a_chunked_leaf_that_reads_back_whole() {
        let (_root, repo) = repo();
        let bytes = bytes_of(LEAF_INLINE_MAX * 3 + 17);
        write_sample(&repo, "Samples/Imported/long.wav", &bytes);
        let save = save_main(&repo, &with_sample("Samples/Imported/long.wav", "1"));
        let sample = only_sample(&repo, &save);
        let object = sample.object.unwrap();
        assert_eq!(object, repo.store().put_leaf(&bytes).unwrap());
        assert_eq!(sample.size, Some(bytes.len() as u64));
        assert_eq!(repo.store().read_leaf(&object).unwrap(), bytes);
    }

    #[test]
    fn a_missing_sample_stays_untracked_and_the_save_is_still_recorded() {
        let (_root, repo) = repo();
        let save = save_main(&repo, &with_sample("Samples/gone.wav", "1"));
        let sample = only_sample(&repo, &save);
        assert_eq!((sample.object, sample.size), (None, None));
        assert_eq!(sample.kind, SampleKind::Project);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_sample_stays_untracked_and_the_save_is_still_recorded() {
        use std::os::unix::fs::PermissionsExt;

        let (_root, repo) = repo();
        let path = write_sample(&repo, "Samples/locked.wav", b"kick");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        // A process that ignores file modes (root) reads the file anyway, and then there is nothing to check.
        if fs::File::open(&path).is_ok() {
            return;
        }

        let save = save_main(&repo, &with_sample("Samples/locked.wav", "1"));

        let sample = only_sample(&repo, &save);
        assert_eq!((sample.object, sample.size), (None, None));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[test]
    fn a_sample_outside_samples_or_the_project_is_never_read() {
        let (root, repo) = repo();
        fs::write(root.path().join("secret.wav"), b"secret").unwrap();
        write_sample(&repo, "Recorded/take.wav", b"take");
        let doc = "<doc>\n<sample kind=\"project\" path=\"/a\" rel=\"../secret.wav\"/>\n<sample kind=\"project\" path=\"/b\" rel=\"Recorded/take.wav\"/>\n<sample kind=\"outside\" path=\"/c\" rel=\"Samples/x.wav\"/>\n<blob>1";
        let save = save_main(&repo, doc);
        let samples = repo.read_save(&save).unwrap().samples;
        assert_eq!(samples.len(), 3);
        assert!(
            samples
                .iter()
                .all(|s| s.object.is_none() && s.size.is_none())
        );
    }

    #[test]
    fn a_file_with_the_same_size_and_mtime_is_not_read_again() {
        let (_root, repo) = repo();
        let path = write_sample(&repo, "Samples/k.wav", b"aaaa");
        set_mtime(&path, Duration::from_secs(1000));
        let first = only_sample(&repo, &save_main(&repo, &with_sample("Samples/k.wav", "1")));

        // Same length and time, different bytes: only a cache hit answers with the old object.
        fs::write(&path, b"bbbb").unwrap();
        set_mtime(&path, Duration::from_secs(1000));
        let second = only_sample(&repo, &save_main(&repo, &with_sample("Samples/k.wav", "2")));
        assert_eq!(second.object, first.object);

        // A new mtime is a new read.
        set_mtime(&path, Duration::from_secs(2000));
        let third = only_sample(&repo, &save_main(&repo, &with_sample("Samples/k.wav", "3")));
        assert_eq!(third.object, Some(ObjectId::of(ObjectKind::Blob, b"bbbb")));
        // And so is a new size.
        fs::write(&path, b"bbbbb").unwrap();
        set_mtime(&path, Duration::from_secs(2000));
        let fourth = only_sample(&repo, &save_main(&repo, &with_sample("Samples/k.wav", "4")));
        assert_eq!(fourth.size, Some(5));
    }

    #[test]
    fn the_cache_lives_in_dit_and_a_damaged_one_is_only_a_cold_start() {
        let (_root, repo) = repo();
        let path = write_sample(&repo, "Samples/k.wav", b"aaaa");
        set_mtime(&path, Duration::from_secs(1000));
        save_main(&repo, &with_sample("Samples/k.wav", "1"));
        let cache = repo.root().join(".dit/samples.json");
        assert!(cache.is_file());

        fs::write(&cache, b"{ not json").unwrap();
        fs::write(&path, b"bbbb").unwrap();
        set_mtime(&path, Duration::from_secs(1000));
        let save = save_main(&repo, &with_sample("Samples/k.wav", "2"));
        assert_eq!(
            only_sample(&repo, &save).object,
            Some(ObjectId::of(ObjectKind::Blob, b"bbbb"))
        );
    }

    #[test]
    fn imported_backups_resolve_against_todays_samples() {
        let (_root, repo) = repo();
        write_sample(&repo, "Samples/k.wav", b"kick");
        let (set, _) = save_main_at(&repo, &with_sample("Samples/k.wav", "now"), 5000);
        write_backup(
            &repo,
            "Song [a].tset",
            &with_sample("Samples/k.wav", "old"),
            1000,
        );

        let report = repo.import_backups(&set, "main").unwrap();

        let sample = only_sample(&repo, &report.imported[0]);
        assert_eq!(sample.object, Some(ObjectId::of(ObjectKind::Blob, b"kick")));
    }

    #[test]
    fn a_300_mb_sample_is_chunked_without_being_held_whole() {
        let (_root, repo) = repo();
        let path = repo.root().join("Samples/big.wav");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = fs::File::create(&path).unwrap();
        let mut x = 0x2468_ace1u32;
        let mut block = vec![0u8; 1 << 20];
        for _ in 0..300 {
            for byte in block.iter_mut() {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                *byte = (x >> 24) as u8;
            }
            std::io::Write::write_all(&mut file, &block).unwrap();
        }
        drop(file);

        let save = save_main(&repo, &with_sample("Samples/big.wav", "1"));

        let sample = only_sample(&repo, &save);
        assert_eq!(sample.size, Some(300 << 20));
        let (kind, _) = repo.store().get(&sample.object.unwrap()).unwrap();
        assert_eq!(kind, ObjectKind::Chunked);
    }
}

/// Sets `path`'s modification time to `seconds` after the epoch.
fn set_time(path: &Path, seconds: u64) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(UNIX_EPOCH + Duration::from_secs(seconds))
        .unwrap();
}

mod replaced_samples {
    use super::*;

    const REL: &str = "Samples/k.wav";

    fn document() -> String {
        format!("<doc>\n<sample kind=\"project\" path=\"/p/{REL}\" rel=\"{REL}\"/>\n<blob>1")
    }

    fn sample_path(repo: &Repo) -> PathBuf {
        repo.root().join(REL)
    }

    /// A repo whose set references one sample, recorded with the set at 1000 s and the sample at 500 s.
    fn recorded() -> (tempfile::TempDir, Repo, ObjectId) {
        let (root, repo) = repo();
        fs::create_dir_all(repo.root().join("Samples")).unwrap();
        fs::write(sample_path(&repo), b"kick").unwrap();
        set_time(&sample_path(&repo), 500);
        write_set(&set_path(&repo), &document());
        set_time(&set_path(&repo), 1000);
        let first = repo.record_save(&set_path(&repo)).unwrap().unwrap();
        (root, repo, first)
    }

    fn replace(repo: &Repo, bytes: &[u8], seconds: u64) {
        fs::write(sample_path(repo), bytes).unwrap();
        set_time(&sample_path(repo), seconds);
    }

    fn record(repo: &Repo) -> Option<ObjectId> {
        repo.record_save(&set_path(repo)).unwrap()
    }

    #[test]
    fn a_replaced_sample_records_a_save_at_the_samples_time_that_commits() {
        let (_root, repo, first) = recorded();
        let set = set_id(&repo);
        user_commit(&repo, &set, "main", "first");

        replace(&repo, b"snare", 2000);
        assert!(
            !repo.working_changed(&set, "main").unwrap(),
            "nothing is recorded until the next save"
        );
        let second = record(&repo).expect("a replaced sample is a save");

        let (first_save, second_save) = (
            repo.read_save(&first).unwrap(),
            repo.read_save(&second).unwrap(),
        );
        assert_eq!(first_save.file_updated_at, 1_000_000);
        assert_eq!(second_save.file_updated_at, 2_000_000);
        assert_eq!(second_save.tree, first_save.tree);
        assert_eq!(second_save.xml_hash, first_save.xml_hash);
        assert!(!second_save.view_only, "the sample bytes changed");
        assert_ne!(second_save.samples[0].object, first_save.samples[0].object);
        assert_eq!(repo.log(&set, "main").unwrap(), [first, second]);

        assert!(repo.working_changed(&set, "main").unwrap());
        assert_eq!(repo.saves_since_commit(&set, "main").unwrap(), 1);
        user_commit(&repo, &set, "main", "snare");
        assert!(!repo.working_changed(&set, "main").unwrap());
        assert_eq!(
            repo.commit(&set, "main", "again", "Ada", CommitKind::User),
            Err(RepoError::NothingToCommit {
                since: "snare".to_string()
            })
        );
    }

    #[test]
    fn a_sample_older_than_the_set_is_saved_one_millisecond_after_the_latest_save() {
        let (_root, repo, _) = recorded();

        replace(&repo, b"snare", 700);
        let second = record(&repo).unwrap();
        replace(&repo, b"clap!", 600);
        let third = record(&repo).unwrap();

        assert_eq!(repo.read_save(&second).unwrap().file_updated_at, 1_000_001);
        assert_eq!(repo.read_save(&third).unwrap().file_updated_at, 1_000_002);
    }

    #[test]
    fn a_touched_sample_with_the_same_bytes_records_nothing_and_is_not_read_again() {
        let (_root, repo, _) = recorded();
        let set = set_id(&repo);
        assert!(!repo.stale(&set_path(&repo)).unwrap());

        replace(&repo, b"kick", 3000);
        assert!(repo.stale(&set_path(&repo)).unwrap(), "its time moved");
        assert_eq!(record(&repo), None);

        assert_eq!(repo.log(&set, "main").unwrap().len(), 1);
        assert!(
            !repo.stale(&set_path(&repo)).unwrap(),
            "the cache remembers the new time"
        );
    }

    #[test]
    fn a_replacement_with_the_same_size_and_time_is_not_seen() {
        let (_root, repo, _) = recorded();

        // What `cp -p` and `rsync --times` leave.
        replace(&repo, b"snar", 500);

        assert_eq!(record(&repo), None);
    }

    #[test]
    fn a_sample_that_goes_away_is_no_change_and_returns_unchanged() {
        let (_root, repo, _) = recorded();

        fs::remove_file(sample_path(&repo)).unwrap();
        assert_eq!(record(&repo), None);
        assert!(!repo.stale(&set_path(&repo)).unwrap());
        replace(&repo, b"kick", 500);
        assert_eq!(record(&repo), None);
    }

    #[test]
    fn a_sample_that_appears_after_the_save_records_one() {
        let (_root, repo) = repo();
        write_set(&set_path(&repo), &document());
        set_time(&set_path(&repo), 1000);
        let first = record(&repo).unwrap();
        assert_eq!(repo.read_save(&first).unwrap().samples[0].object, None);

        fs::create_dir_all(repo.root().join("Samples")).unwrap();
        replace(&repo, b"kick", 2000);
        let second = record(&repo).unwrap();

        let save = repo.read_save(&second).unwrap();
        assert!(save.samples[0].object.is_some());
        assert_eq!(save.file_updated_at, 2_000_000);
    }

    #[test]
    fn a_replaced_sample_is_named_in_the_diff_and_is_the_whole_message() {
        let (_root, repo, first) = recorded();
        replace(&repo, b"snare", 2000);
        let second = record(&repo).unwrap();
        let (before, after) = (
            repo.read_save(&first).unwrap(),
            repo.read_save(&second).unwrap(),
        );

        let diff = repo.diff(&before, &after).unwrap();
        let clauses = repo.clauses(&before, &after).unwrap();

        assert_eq!(diff.samples_replaced, ["k.wav"]);
        assert!(diff.tracks_changed.is_empty() && diff.scalars.is_empty());
        assert_eq!(
            clauses,
            [crate::Clause {
                kind: crate::ClauseKind::SampleBytes,
                text: "Replaced sample k.wav".into()
            }]
        );
        assert_eq!(
            crate::summary_line(&diff, before.meta.as_ref(), after.meta.as_ref()),
            "Replaced sample k.wav"
        );
        // The same bytes on both sides name nothing.
        assert!(
            repo.diff(&after, &after)
                .unwrap()
                .samples_replaced
                .is_empty()
        );
    }

    #[test]
    fn two_machines_recording_the_same_replacement_never_share_an_id() {
        let (root, repo, _) = recorded();
        // Another computer's copy of the project, `.dit/` included.
        let copy = root.path().join("Copy Project");
        copy_dir(repo.root(), &copy);
        let other = Repo::open(&copy, &registry())
            .unwrap()
            .with_machine(|| "Laptop".to_string());
        let repo = repo.with_machine(|| "Studio".to_string());

        replace(&repo, b"snare", 2000);
        fs::write(copy.join(REL), b"snare").unwrap();
        set_time(&copy.join(REL), 2000);
        let here = record(&repo).unwrap();
        let there = other.record_save(&copy.join("Song.tset")).unwrap().unwrap();

        assert_ne!(here, there);
        assert_eq!(repo.read_save(&here).unwrap().machine, "Studio");
        assert_eq!(other.read_save(&there).unwrap().machine, "Laptop");
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.path().is_dir() {
                copy_dir(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), &target).unwrap();
                let modified = fs::metadata(entry.path()).unwrap().modified().unwrap();
                fs::File::options()
                    .write(true)
                    .open(&target)
                    .unwrap()
                    .set_modified(modified)
                    .unwrap();
            }
        }
    }
}

mod unreadable_files {
    use super::*;
    use crate::store::LEAF_INLINE_MAX;

    /// The test DAW's marker, then bytes that are not UTF-8: the file decodes and cannot be split.
    fn write_unreadable(repo: &Repo, extra: &[u8]) -> Vec<u8> {
        let bytes = [MARKER, &[0xff, 0xfe], extra].concat();
        fs::write(set_path(repo), &bytes).unwrap();
        bytes
    }

    #[test]
    fn a_whole_file_that_cannot_be_read_is_stored_as_its_bytes() {
        let (_root, repo) = repo();
        let bytes = write_unreadable(&repo, b"tail");

        let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

        let save = repo.read_save(&id).unwrap();
        assert!(save.unreadable);
        assert_eq!(
            (&save.xml_hash, &save.tree, &save.side, &save.meta),
            (&None, &None, &None, &None)
        );
        assert!(save.raw.is_some() && save.document().is_none());
        assert_eq!(repo.materialise(&save).unwrap(), bytes);
        assert_eq!(repo.materialise_xml(&save), Err(RepoError::NoDocument));
        assert_eq!(repo.log(&set_id(&repo), "main").unwrap(), [id]);
        let json = serde_json::to_value(&save).unwrap();
        assert!(
            json.get("raw").is_some()
                && json.get("tree").is_none()
                && json.get("xmlHash").is_none()
        );
    }

    #[test]
    fn a_large_unreadable_file_is_chunked_and_reads_back_whole() {
        let (_root, repo) = repo();
        let bytes = write_unreadable(&repo, &blob_of(LEAF_INLINE_MAX * 3).into_bytes());

        let id = repo.record_save(&set_path(&repo)).unwrap().unwrap();

        let save = repo.read_save(&id).unwrap();
        let (kind, _) = repo.store().get(&save.raw.unwrap()).unwrap();
        assert_eq!(kind, ObjectKind::Chunked);
        assert_eq!(repo.materialise(&save).unwrap(), bytes);
    }

    #[test]
    fn the_same_unreadable_bytes_record_nothing_again() {
        let (_root, repo) = repo();
        write_unreadable(&repo, b"");
        repo.record_save(&set_path(&repo)).unwrap().unwrap();

        assert_eq!(repo.record_save(&set_path(&repo)).unwrap(), None);

        assert_eq!(repo.log(&set_id(&repo), "main").unwrap().len(), 1);
        assert!(
            repo.stale(&set_path(&repo)).unwrap(),
            "a newer release may read it"
        );
    }

    #[test]
    fn the_next_save_that_can_read_the_file_records_its_document() {
        let (_root, repo) = repo();
        write_unreadable(&repo, b"");
        let raw = repo.record_save(&set_path(&repo)).unwrap().unwrap();

        write_set(&set_path(&repo), &xml(1, 2, "b"));
        let read = repo.record_save(&set_path(&repo)).unwrap().unwrap();

        let save = repo.read_save(&read).unwrap();
        assert!(save.xml_hash.is_some() && save.tree.is_some() && save.raw.is_none());
        assert!(!save.unreadable && !save.view_only);
        assert_eq!(repo.log(&set_id(&repo), "main").unwrap(), [raw, read]);
        let json = serde_json::to_value(&save).unwrap();
        assert!(json.get("raw").is_none());
    }

    #[test]
    fn a_file_that_is_not_whole_is_refused_and_nothing_is_stored() {
        let (_root, repo) = repo();
        fs::write(set_path(&repo), b"no marker, so the gzip is not whole").unwrap();

        let error = repo.record_save(&set_path(&repo)).unwrap_err();

        assert!(
            matches!(error, RepoError::Daw(crate::daw::DawError::Corrupt(_))),
            "{error}"
        );
        assert!(repo.sets().unwrap().is_empty());
    }

    #[test]
    fn an_unreadable_save_commits_and_cannot_be_diffed() {
        let (_root, repo) = repo();
        let first = save_main(&repo, &xml(1, 2, "b"));
        write_unreadable(&repo, b"");
        let raw = repo.record_save(&set_path(&repo)).unwrap().unwrap();
        let set = set_id(&repo);

        user_commit(&repo, &set, "main", "readable");
        assert_eq!(repo.saves_since_commit(&set, "main").unwrap(), 0);

        let diff = repo.diff(
            &repo.read_save(&first).unwrap(),
            &repo.read_save(&raw).unwrap(),
        );
        assert_eq!(diff, Err(RepoError::NoDocument));
    }
}

mod catching_up {
    use super::*;

    fn other_path(repo: &Repo) -> PathBuf {
        repo.root().join("Other.tset")
    }

    #[test]
    fn a_set_nothing_has_recorded_is_stale_and_a_recorded_one_is_not() {
        let (_root, repo) = repo();
        write_set(&set_path(&repo), &xml(1, 2, "b"));
        assert!(repo.stale(&set_path(&repo)).unwrap());

        repo.record_save(&set_path(&repo)).unwrap();
        assert!(!repo.stale(&set_path(&repo)).unwrap());

        write_set(&set_path(&repo), &xml(1, 2, "c"));
        set_time(&set_path(&repo), 4242);
        assert!(repo.stale(&set_path(&repo)).unwrap());
    }

    #[test]
    fn catch_up_records_only_the_sets_that_are_stale() {
        let (_root, repo) = repo();
        write_set(&set_path(&repo), &xml(1, 2, "b"));
        repo.record_save(&set_path(&repo)).unwrap();
        write_set(&other_path(&repo), &xml(3, 4, "d"));

        let caught = repo.catch_up().unwrap();

        assert_eq!(caught.len(), 1);
        assert_eq!(caught[0].0, other_path(&repo));
        assert!(matches!(caught[0].1, Ok(Some(_))));
        assert_eq!(repo.sets().unwrap().len(), 2);
        assert!(repo.catch_up().unwrap().is_empty(), "nothing is stale now");
    }

    #[test]
    fn catch_up_reports_a_file_that_is_not_whole_beside_the_ones_it_recorded() {
        let (_root, repo) = repo();
        write_set(&set_path(&repo), &xml(1, 2, "b"));
        repo.record_save(&set_path(&repo)).unwrap();
        write_set(&other_path(&repo), &xml(3, 4, "d"));
        fs::write(set_path(&repo), b"half written").unwrap();
        set_time(&set_path(&repo), 4242);

        let caught = repo.catch_up().unwrap();

        assert_eq!(caught.len(), 2);
        let song = caught
            .iter()
            .find(|(path, _)| *path == set_path(&repo))
            .unwrap();
        assert!(matches!(song.1, Err(RepoError::Daw(_))));
        assert!(
            caught
                .iter()
                .any(|(path, result)| *path == other_path(&repo) && matches!(result, Ok(Some(_))))
        );
    }

    #[test]
    fn the_newest_save_is_found_across_sets_and_branches() {
        let (_root, repo) = repo();
        assert_eq!(repo.newest_save_at().unwrap(), None);
        write_set(&set_path(&repo), &xml(1, 2, "b"));
        set_time(&set_path(&repo), 1000);
        repo.record_save(&set_path(&repo)).unwrap();
        write_set(&other_path(&repo), &xml(3, 4, "d"));
        set_time(&other_path(&repo), 2000);
        repo.record_save(&other_path(&repo)).unwrap();
        let other_set = repo
            .sets()
            .unwrap()
            .into_iter()
            .find(|(_, file)| file == "Other.tset")
            .unwrap()
            .0;

        assert_eq!(
            repo.newest_save_at().unwrap(),
            Some((other_set, "main".to_string(), 2_000_000))
        );
    }
}

mod time_in_set {
    use super::*;

    const SECOND: i64 = 1000;

    fn span(start: i64, end: i64, source: Source) -> Segment {
        Segment {
            start: start * SECOND,
            end: end * SECOND,
            source,
        }
    }

    /// A repo with a set's first save recorded, so there is a set id to keep time under.
    fn with_set() -> (tempfile::TempDir, Repo, String) {
        let (root, repo) = repo();
        save_main(&repo, &xml(1, 2, "b"));
        let set = set_id(&repo);
        (root, repo, set)
    }

    fn time_file(repo: &Repo, set: &str) -> PathBuf {
        repo.root().join(".dit/time").join(set).join("main")
    }

    #[test]
    fn a_branch_with_no_spans_has_no_time() {
        let (_root, repo, set) = with_set();
        assert_eq!(repo.segments(&set, "main").unwrap(), []);
        assert_eq!(
            repo.time_in_set(&set, "main", i64::MIN, i64::MAX).unwrap(),
            0
        );
        assert!(!time_file(&repo, &set).exists());
    }

    #[test]
    fn a_span_is_a_json_line_and_a_span_with_the_same_start_is_replaced() {
        let (_root, repo, set) = with_set();

        repo.upsert_segment(&set, "main", &span(100, 100, Source::Saves))
            .unwrap();
        repo.upsert_segment(&set, "main", &span(100, 160, Source::Script))
            .unwrap();
        repo.upsert_segment(&set, "main", &span(20, 40, Source::Log))
            .unwrap();

        assert_eq!(
            repo.segments(&set, "main").unwrap(),
            [span(20, 40, Source::Log), span(100, 160, Source::Script)],
            "sorted by start, the grown span having replaced the first"
        );
        assert_eq!(
            fs::read_to_string(time_file(&repo, &set)).unwrap(),
            "{\"start\":20000,\"end\":40000,\"source\":\"log\"}\n\
             {\"start\":100000,\"end\":160000,\"source\":\"script\"}\n"
        );
    }

    #[test]
    fn a_span_cannot_end_before_it_starts_and_the_names_are_checked() {
        let (_root, repo, set) = with_set();
        let backwards = Segment {
            start: 10,
            end: 9,
            source: Source::Script,
        };
        assert_eq!(
            repo.upsert_segment(&set, "main", &backwards),
            Err(RepoError::BadSegment { start: 10, end: 9 })
        );
        assert_eq!(
            repo.upsert_segment("../x", "main", &span(1, 2, Source::Script)),
            Err(RepoError::BadSetId("../x".into()))
        );
        assert!(matches!(
            repo.segments(&set, "a/b"),
            Err(RepoError::BadBranchName(_))
        ));
    }

    #[test]
    fn time_is_the_spans_clipped_to_the_window_with_overlaps_counted_once() {
        let (_root, repo, set) = with_set();
        for segment in [
            span(0, 100, Source::Script),
            span(50, 120, Source::Log),
            span(200, 300, Source::Saves),
        ] {
            repo.upsert_segment(&set, "main", &segment).unwrap();
        }
        let ms = |from: i64, to: i64| {
            repo.time_in_set(&set, "main", from * SECOND, to * SECOND)
                .unwrap()
                / SECOND
        };

        assert_eq!(
            ms(i64::MIN / SECOND, i64::MAX / SECOND),
            120 + 100,
            "0..120 and 200..300"
        );
        assert_eq!(ms(30, 250), 90 + 50, "30..120 and 200..250");
        assert_eq!(ms(120, 200), 0);
        assert_eq!(ms(110, 210), 10 + 10);
    }

    #[test]
    fn a_crash_mid_write_leaves_the_old_file_and_the_next_write_goes_through() {
        let (_root, repo, set) = with_set();
        repo.upsert_segment(&set, "main", &span(10, 20, Source::Script))
            .unwrap();
        // A temp file the writer died in, beside the real one.
        let dir = time_file(&repo, &set).parent().unwrap().to_path_buf();
        fs::write(dir.join(".tmp-99999-0"), "{\"start\":10000,\"en").unwrap();

        assert_eq!(
            repo.segments(&set, "main").unwrap(),
            [span(10, 20, Source::Script)]
        );
        repo.upsert_segment(&set, "main", &span(30, 40, Source::Script))
            .unwrap();
        assert_eq!(repo.segments(&set, "main").unwrap().len(), 2);
    }

    #[test]
    fn a_last_line_cut_short_is_dropped_and_a_bad_line_before_it_is_an_error() {
        let (_root, repo, set) = with_set();
        let file = time_file(&repo, &set);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let whole = "{\"start\":1000,\"end\":2000,\"source\":\"script\"}\n";

        fs::write(&file, format!("{whole}{{\"start\":3000,\"en")).unwrap();
        assert_eq!(
            repo.segments(&set, "main").unwrap(),
            [span(1, 2, Source::Script)]
        );
        repo.upsert_segment(&set, "main", &span(5, 6, Source::Log))
            .unwrap();
        assert_eq!(
            repo.segments(&set, "main").unwrap().len(),
            2,
            "rewritten whole"
        );

        fs::write(&file, format!("not json\n{whole}")).unwrap();
        assert!(matches!(
            repo.segments(&set, "main"),
            Err(RepoError::Store(_))
        ));
    }

    // The hub's route test "charges each commit the window after its parent's save up to its own, as dit time does"
    // (`apps/server/src/routes/repo-history.test.ts`) uses these same numbers: the two sides read one window,
    // `(parent commit's save file time, own save file time]`, and a change to either has to change both tests.
    #[test]
    fn each_commit_is_charged_the_time_between_the_previous_commits_save_and_its_own() {
        let (_root, repo) = repo();
        let mut commits = Vec::new();
        for (n, seconds) in [1000u64, 2000, 3000].into_iter().enumerate() {
            write_set(&set_path(&repo), &xml(1, 2, &format!("b{n}")));
            set_time(&set_path(&repo), seconds);
            repo.record_save(&set_path(&repo)).unwrap().unwrap();
            commits.push(user_commit(
                &repo,
                &set_id(&repo),
                "main",
                &format!("commit {n}"),
            ));
        }
        let set = set_id(&repo);
        for segment in [
            span(500, 1500, Source::Script),
            span(2100, 2900, Source::Script),
            span(2950, 3500, Source::Log),
        ] {
            repo.upsert_segment(&set, "main", &segment).unwrap();
        }

        let by_commit: Vec<_> = repo
            .time_by_commit(&set, "main")
            .unwrap()
            .into_iter()
            .map(|(id, ms)| (id, ms / SECOND))
            .collect();

        assert_eq!(
            by_commit,
            [(commits[2], 800 + 50), (commits[1], 500), (commits[0], 500),]
        );
        assert_eq!(
            repo.time_since_commit(&set, "main").unwrap() / SECOND,
            500,
            "after the head's save at 3000: 3000..3500"
        );
    }

    #[test]
    fn with_no_head_all_the_time_is_since_the_last_commit() {
        let (_root, repo, set) = with_set();
        repo.upsert_segment(&set, "main", &span(10, 70, Source::Script))
            .unwrap();
        assert_eq!(repo.time_since_commit(&set, "main").unwrap(), 60 * SECOND);
        assert_eq!(repo.time_by_commit(&set, "main").unwrap(), []);
    }

    #[test]
    fn a_span_reads_as_hours_and_minutes_floored() {
        let at = |minutes: i64, seconds: i64| format_span(minutes * 60_000 + seconds * 1000);
        assert_eq!(at(0, 0), "<1m");
        assert_eq!(at(0, 59), "<1m");
        assert_eq!(at(1, 0), "1m");
        assert_eq!(at(41, 59), "41m");
        assert_eq!(at(60, 0), "1h");
        assert_eq!(at(134, 30), "2h 14m");
        assert_eq!(format_span(-5), "<1m");
    }
}
