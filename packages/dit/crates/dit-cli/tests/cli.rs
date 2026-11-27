//! Runs the built `dit` binary over temp copies of the Ableton contract fixture project.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, SystemTime};

use dit_core::Daw;
use dit_core::remote::{RebindError, RemoteError};
use dit_daw_ableton::Ableton;
use serde_json::{Value, json};
use tempfile::TempDir;

const PROJECT: &str = "Contract Fixtures Project";
const EMPTY: &str = "Empty Set.als";
const ARRANGED: &str = "Arranged Set.als";

/// A copy of the fixture project in a temp folder.
struct Fixture {
    _root: TempDir,
    dir: PathBuf,
    /// Stands in for the user's home and config folder, so no test reads a real sign-in.
    home: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(PROJECT);
        fs::create_dir(&dir).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../dit-daw-ableton/fixtures")
            .join(PROJECT);
        for name in [EMPTY, ARRANGED] {
            fs::copy(source.join(name), dir.join(name)).unwrap();
        }
        let home = root.path().join("home");
        fs::create_dir(&home).unwrap();
        Fixture {
            _root: root,
            dir,
            home,
        }
    }

    fn set_path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// Rewrites the set's tempo, the way Live would on a save.
    fn set_tempo(&self, name: &str, bpm: &str) {
        let path = self.set_path(name);
        let xml = String::from_utf8(Ableton.decode(&fs::read(&path).unwrap()).unwrap()).unwrap();
        let tempo = xml.find("<Tempo>").expect("the set has a tempo");
        let value =
            tempo + xml[tempo..].find("<Manual Value=\"").unwrap() + "<Manual Value=\"".len();
        let end = value + xml[value..].find('"').unwrap();
        let edited = format!("{}{bpm}{}", &xml[..value], &xml[end..]);
        fs::write(&path, Ableton.encode(edited.as_bytes()).unwrap()).unwrap();
    }

    fn set_modified(&self, name: &str, seconds_after_epoch: u64) {
        let file = fs::File::options()
            .write(true)
            .open(self.set_path(name))
            .unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds_after_epoch))
            .unwrap();
    }

    fn dit(&self, args: &[&str]) -> Output {
        run(&self.dir, &self.home, args)
    }

    /// Runs `dit` with `DIT_MACHINE` set to `machine`.
    fn dit_as(&self, machine: &str, args: &[&str]) -> Output {
        command(&self.dir, &self.home, args)
            .env("DIT_MACHINE", machine)
            .output()
            .unwrap()
    }

    /// Writes the user config `text`; the platform decides where the config folder is under the isolated home.
    fn write_user_config(&self, text: &str) {
        for folder in ["Library/Application Support/dit", "dit"] {
            let folder = self.home.join(folder);
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("config.toml"), text).unwrap();
        }
    }

    /// The machine name a save was recorded under.
    fn machine_of(&self, save_id: &Value) -> String {
        let registry = dit_core::Registry::new(vec![&Ableton]).unwrap();
        let repo = dit_core::Repo::open(&self.dir, &registry).unwrap();
        repo.read_save(&id(save_id).parse().unwrap())
            .unwrap()
            .machine
    }

    /// Runs `dit` and parses its `--json` output, which must have succeeded.
    fn json(&self, args: &[&str]) -> Value {
        let mut all = args.to_vec();
        all.push("--json");
        let output = self.dit(&all);
        assert!(output.status.success(), "dit {all:?}: {}", stderr(&output));
        serde_json::from_slice(&output.stdout).expect("stdout is one JSON document")
    }

    /// The number of saves in a set's `main` log.
    fn saves(&self, set_id: &str) -> usize {
        fs::read_to_string(self.dir.join(".dit/logs").join(set_id).join("main"))
            .unwrap()
            .lines()
            .count()
    }
}

fn command(dir: &Path, home: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_dit"));
    command
        .current_dir(dir)
        .args(args)
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home)
        .env("DIT_AUTHOR", "tester")
        .env("DIT_MACHINE", "test");
    command
}

fn run(dir: &Path, home: &Path, args: &[&str]) -> Output {
    command(dir, home, args).output().unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string()
}

/// The status row of the named file.
fn row<'a>(status: &'a Value, file: &str) -> &'a Value {
    status["sets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["file"] == file)
        .unwrap_or_else(|| panic!("no row for {file} in {status}"))
}

#[test]
fn init_lists_the_repo_for_the_dit_app_once() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["init"]);

    let folder = if cfg!(target_os = "macos") {
        fixture.home.join("Library/Application Support/dit")
    } else {
        fixture.home.join("dit")
    };
    let list = fs::read_to_string(folder.join("repos.toml")).unwrap();
    let root = fixture.dir.canonicalize().unwrap();
    assert_eq!(list.matches(root.to_str().unwrap()).count(), 1, "{list}");
}

#[test]
fn init_records_a_save_of_every_set() {
    let fixture = Fixture::new();
    let output = fixture.dit(&["init"]);
    assert!(output.status.success(), "{}", stderr(&output));
    let text = stdout(&output);
    assert!(text.starts_with("dit repo ready in "), "{text}");
    assert!(text.contains(&format!("  {ARRANGED}")), "{text}");
    assert!(text.contains(&format!("  {EMPTY}")), "{text}");

    let result = fixture.json(&["init"]);
    assert_eq!(result["daw"], "ableton");
    let sets = result["sets"].as_array().unwrap();
    assert_eq!(sets.len(), 2);
    for set in sets {
        assert_eq!(set["branch"], "main");
        assert_eq!(fixture.saves(set["setId"].as_str().unwrap()), 1);
    }
    assert_eq!(sets[0]["file"], ARRANGED, "sorted by file");
}

#[test]
fn init_from_a_folder_inside_the_project_uses_the_project_folder() {
    let fixture = Fixture::new();
    let inner = fixture.dir.join("Samples");
    fs::create_dir(&inner).unwrap();
    let output = run(&inner, &fixture.home, &["init"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(fixture.dir.join(".dit").is_dir());
    assert!(!inner.join(".dit").exists());
}

#[test]
fn init_outside_a_project_folder_fails() {
    let root = tempfile::tempdir().unwrap();
    let output = run(root.path(), root.path(), &["init"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), "Not a Live project folder.");
    assert_eq!(stdout(&output), "");
}

#[test]
fn a_command_outside_a_repo_says_to_run_init() {
    let fixture = Fixture::new();
    for command in ["status", "log", "commit"] {
        let output = fixture.dit(&[command, "--json"]);
        assert_eq!(output.status.code(), Some(1), "{command}");
        assert_eq!(
            stderr(&output),
            "Not a dit repo. Run dit init in a Live project folder.",
            "{command}"
        );
        assert_eq!(stdout(&output), "", "errors stay off stdout with --json");
    }
}

#[test]
fn status_picks_up_a_set_saved_into_the_project_after_init() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fs::copy(fixture.set_path(EMPTY), fixture.set_path("Copy.als")).unwrap();

    let status = fixture.json(&["status"]);
    assert_eq!(status["sets"].as_array().unwrap().len(), 3);
    let row = row(&status, "Copy.als");
    assert_eq!(row["branch"], "main");
    assert_eq!(row["savesSinceCommit"], 1);
    assert_ne!(
        row["setId"],
        self::row(&status, EMPTY)["setId"],
        "a copy is a new set"
    );
}

#[test]
fn status_reports_an_uncommitted_set_in_text_and_json() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let status = fixture.json(&["status"]);
    for file in [ARRANGED, EMPTY] {
        let row = row(&status, file);
        assert_eq!(row["branch"], "main");
        assert_eq!(row["savesSinceCommit"], 1);
        assert_eq!(row["workingChanged"], true);
        assert_eq!(row["setId"].as_str().unwrap().len(), 16);
    }

    let text = stdout(&fixture.dit(&["status"]));
    assert_eq!(
        text,
        format!(
            "{ARRANGED} (main): 1 save since the last commit, changes to commit, 1 save and 0 commits to push\n\
             {EMPTY} (main): 1 save since the last commit, changes to commit, 1 save and 0 commits to push"
        )
    );
}

#[test]
fn status_records_a_save_when_the_file_changed() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "first", EMPTY]);
    let status = fixture.json(&["status"]);
    let id = row(&status, EMPTY)["setId"].as_str().unwrap().to_string();
    assert_eq!(row(&status, EMPTY)["savesSinceCommit"], 0);
    assert_eq!(row(&status, EMPTY)["workingChanged"], false);
    assert_eq!(fixture.saves(&id), 1);

    fixture.set_tempo(EMPTY, "140");
    let status = fixture.json(&["status"]);
    assert_eq!(fixture.saves(&id), 2);
    assert_eq!(row(&status, EMPTY)["savesSinceCommit"], 1);
    assert_eq!(row(&status, EMPTY)["workingChanged"], true);

    fixture.json(&["status"]);
    assert_eq!(fixture.saves(&id), 2, "an unchanged file records nothing");
    assert_eq!(
        stdout(&fixture.dit(&["status", EMPTY])),
        format!(
            "{EMPTY} (main): 1 save since the last commit, changes to commit, 2 saves and 1 commit to push"
        )
    );
}

#[test]
fn status_warns_about_a_file_that_does_not_decode_and_reports_the_rest() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let whole = fs::read(fixture.set_path(EMPTY)).unwrap();
    fs::write(fixture.set_path(EMPTY), &whole[..whole.len() / 2]).unwrap();

    let output = fixture.dit(&["status", "--json"]);
    assert!(output.status.success());
    assert!(
        stderr(&output).starts_with(&format!("warning: {EMPTY}: ")),
        "{}",
        stderr(&output)
    );
    let status: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(row(&status, EMPTY)["savesSinceCommit"], 1);
    assert_eq!(status["sets"].as_array().unwrap().len(), 2);
}

#[test]
fn the_first_commit_is_an_initial_commit_with_no_diff() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let output = fixture.dit(&["commit", "--no-push", EMPTY]);
    assert!(output.status.success(), "{}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.starts_with("[main ") && text.ends_with("] Initial commit"),
        "{text}"
    );
    assert_eq!(text.len(), "[main ".len() + 8 + "] Initial commit".len());

    let result = fixture.json(&["commit", "-m", "second set", ARRANGED]);
    assert_eq!(result["message"], "second set");
    assert_eq!(result["diff"], Value::Null);
    assert_eq!(result["id"].as_str().unwrap().len(), 64);
}

#[test]
fn a_later_commit_is_named_by_the_diff_summary_and_carries_the_diff() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "first", EMPTY]);
    fixture.set_tempo(EMPTY, "140");

    let result = fixture.json(&["commit", EMPTY]);
    let diff = &result["diff"];
    assert_eq!(
        diff["scalars"],
        json!([{ "field": "tempo", "from": "120", "to": "140" }])
    );
    let message = result["message"].as_str().unwrap();
    assert!(message.ends_with("tempo 120 → 140"), "{message}");
    assert_eq!(diff["tracksAdded"], json!([]));
    assert_eq!(diff["tracksRemoved"], json!([]));
}

#[test]
fn the_default_commit_message_is_the_line_dit_diff_prints_for_the_same_pair() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first", EMPTY]);
    fixture.set_tempo(EMPTY, "140");

    let diff = fixture.dit(&["diff", "--set", EMPTY]);
    let line = stdout(&diff).lines().next().unwrap().to_string();
    let commit = fixture.json(&["commit", "--no-push", EMPTY]);

    assert!(line.ends_with("tempo 120 → 140"), "{line}");
    assert_eq!(commit["message"], line.as_str());
}

#[test]
fn a_message_given_with_m_wins_over_the_summary() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "first", EMPTY]);
    fixture.set_tempo(EMPTY, "128");

    let result = fixture.json(&["commit", "-m", "faster", EMPTY]);
    assert_eq!(result["message"], "faster");
    assert_eq!(result["diff"]["scalars"][0]["to"], "128");
}

#[test]
fn committing_twice_with_no_change_is_refused() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "the first one", EMPTY]);

    let output = fixture.dit(&["commit", EMPTY]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), "Nothing to commit since 'the first one'.");
    assert_eq!(stdout(&output), "");
}

#[test]
fn log_lists_commits_newest_first_with_their_saves_folded() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let first = fixture.json(&["commit", "-m", "first", EMPTY]);
    fixture.set_tempo(EMPTY, "130");
    fixture.json(&["status"]);
    fixture.set_tempo(EMPTY, "140");
    let second = fixture.json(&["commit", "-m", "second", EMPTY]);

    let log = fixture.json(&["log", EMPTY]);
    let commits = log["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0]["id"], second["id"]);
    assert_eq!(commits[0]["message"], "second");
    assert_eq!(commits[0]["author"], "tester");
    assert_eq!(commits[0]["kind"], "user");
    assert!(commits[0]["at"].as_i64().unwrap() > 0);
    assert_eq!(commits[1]["id"], first["id"]);

    let folded = commits[0]["saves"].as_array().unwrap();
    assert_eq!(folded.len(), 2, "the 130 and the 140 save");
    assert_eq!(commits[1]["saves"].as_array().unwrap().len(), 1);
    for save in folded {
        assert_eq!(save["id"].as_str().unwrap().len(), 64);
        assert!(save["at"].as_i64().unwrap() > 0);
        assert_eq!(save["viewOnly"], false);
    }

    let text = stdout(&fixture.dit(&["log", EMPTY]));
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 5, "{text}");
    assert_eq!(
        lines[0],
        format!("{} second", &second["id"].as_str().unwrap()[..8])
    );
    assert_eq!(
        lines[1],
        format!("    save {}", &folded[0]["id"].as_str().unwrap()[..8])
    );
    assert_eq!(
        lines[3],
        format!("{} first", &first["id"].as_str().unwrap()[..8])
    );
}

#[test]
fn log_of_a_set_with_no_commits_is_empty() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    assert_eq!(fixture.json(&["log", EMPTY]), json!({ "commits": [] }));
    assert_eq!(stdout(&fixture.dit(&["log", EMPTY])), "No commits yet.");
}

#[test]
fn a_set_matches_by_file_name_with_or_without_the_extension() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    for name in ["Empty Set", "Empty Set.als"] {
        let status = fixture.json(&["status", name]);
        let rows = status["sets"].as_array().unwrap();
        assert_eq!(rows.len(), 1, "{name}");
        assert_eq!(rows[0]["file"], EMPTY, "{name}");
    }
    fixture.json(&["commit", "-m", "by stem", "Empty Set"]);
    assert_eq!(
        fixture.json(&["log", "Empty Set.als"])["commits"][0]["message"],
        "by stem"
    );
    assert_eq!(
        fixture.json(&["log", "Arranged Set"]),
        json!({ "commits": [] })
    );

    let output = fixture.dit(&["status", "Nope"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), "No set named `Nope`.");
}

#[test]
fn the_default_set_is_the_one_saved_most_recently() {
    let fixture = Fixture::new();
    fixture.set_modified(ARRANGED, 1_000);
    fixture.set_modified(EMPTY, 2_000);
    fixture.dit(&["init"]);

    fixture.json(&["commit", "-m", "newest file"]);
    assert_eq!(
        fixture.json(&["log", EMPTY])["commits"][0]["message"],
        "newest file"
    );
    assert_eq!(fixture.json(&["log", ARRANGED]), json!({ "commits": [] }));
    assert_eq!(
        fixture.json(&["log"])["commits"][0]["message"],
        "newest file"
    );

    // A change Live just saved has not been recorded yet: commit records it first.
    fixture.set_tempo(ARRANGED, "99");
    let result = fixture.json(&["commit", "-m", "just saved"]);
    assert_eq!(result["message"], "just saved");
    assert_eq!(
        fixture.json(&["log", ARRANGED])["commits"][0]["message"],
        "just saved"
    );
}

#[test]
fn save_with_no_set_records_the_file_modified_last_on_disk() {
    let fixture = Fixture::new();
    fixture.set_modified(ARRANGED, 1_000);
    fixture.set_modified(EMPTY, 2_000);
    fixture.dit(&["init"]);

    // The recorded saves say Empty Set is newest; Live has since saved Arranged Set.
    fixture.set_tempo(ARRANGED, "99");
    let result = fixture.json(&["save"]);
    assert!(result["id"].is_string(), "{result}");
    assert_eq!(
        fixture.json(&["status", ARRANGED])["sets"][0]["savesSinceCommit"],
        2
    );
}

#[test]
fn save_records_the_machine_the_user_config_names_over_dit_machine() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.write_user_config("machine = \"studio\"\n");

    fixture.set_tempo(ARRANGED, "98");
    let result = fixture.json(&["save", ARRANGED]);

    assert_eq!(fixture.machine_of(&result["id"]), "studio");
}

#[test]
fn a_sign_in_that_names_no_machine_leaves_dit_machine_in_charge_of_saves() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.write_user_config("instance = \"http://127.0.0.1:9\"\n");

    for (bpm, machine) in [("98", "studio"), ("99", "laptop")] {
        fixture.set_tempo(ARRANGED, bpm);
        let output = fixture.dit_as(machine, &["save", ARRANGED, "--json"]);
        assert!(output.status.success(), "{}", stderr(&output));
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();

        assert_eq!(fixture.machine_of(&result["id"]), machine);
    }
}

#[test]
fn a_user_config_that_does_not_load_never_stops_a_local_command() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    for (round, config) in ["machine = [\n", "instance = \"ftp://x\"\n"]
        .into_iter()
        .enumerate()
    {
        fixture.write_user_config(config);

        for args in [&["log"][..], &["status"]] {
            let output = fixture.dit(args);
            assert!(output.status.success(), "{args:?}: {}", stderr(&output));
            assert_eq!(stderr(&output), "", "{args:?} with {config:?}");
        }

        // Two changed files record two saves, which warn once between them.
        fixture.set_tempo(ARRANGED, &format!("9{round}"));
        fixture.set_tempo(EMPTY, &format!("8{round}"));
        let output = fixture.dit(&["status", "--json"]);
        assert!(output.status.success(), "{}", stderr(&output));
        let warnings = stderr(&output);
        assert_eq!(warnings.lines().count(), 1, "{warnings}");
        assert!(
            warnings.starts_with("warning: ") && warnings.contains("config.toml"),
            "{warnings}"
        );
    }
}

#[test]
fn a_save_under_a_user_config_that_does_not_load_is_recorded_under_dit_machine() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.write_user_config("machine = [\n");
    fixture.set_tempo(ARRANGED, "98");

    let output = fixture.dit(&["save", ARRANGED, "--json"]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stderr(&output).lines().count(), 1, "{}", stderr(&output));
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(fixture.machine_of(&result["id"]), "test");
}

/// The id of a JSON string field.
fn id(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

/// The names of the files in the project folder, sorted.
fn files(fixture: &Fixture) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(&fixture.dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn diff_with_no_ids_shows_a_tempo_change_since_the_head() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "first", EMPTY]);
    assert_eq!(
        stdout(&fixture.dit(&["diff", "--set", EMPTY])),
        "No changes."
    );

    fixture.set_tempo(EMPTY, "140");
    let diff = fixture.json(&["diff", "--set", EMPTY]);
    assert_eq!(
        diff["scalars"],
        json!([{ "field": "tempo", "from": "120", "to": "140" }])
    );
    assert_eq!(diff["tracksAdded"], json!([]));

    let text = stdout(&fixture.dit(&["diff", "--set", "Empty Set"]));
    let lines: Vec<&str> = text.lines().collect();
    assert!(lines[0].ends_with("tempo 120 → 140"), "{text}");
    assert_eq!(lines.last(), Some(&"tempo: 120 → 140"), "{text}");
    assert!(
        lines.iter().any(|line| line.starts_with("Sections: ")),
        "{text}"
    );
    assert!(
        !lines.iter().any(|line| line.starts_with("Added: ")),
        "{text}"
    );
}

#[test]
fn diff_with_no_ids_on_a_branch_with_no_commit_is_refused() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let output = fixture.dit(&["diff", "--set", EMPTY]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), format!("`{EMPTY}` has no commits yet."));
    assert_eq!(stdout(&output), "");
}

#[test]
fn diff_takes_commit_and_save_id_prefixes() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let first = fixture.json(&["commit", "-m", "first", EMPTY]);
    fixture.set_tempo(EMPTY, "130");
    let second = fixture.json(&["commit", "-m", "second", EMPTY]);
    fixture.set_tempo(EMPTY, "140");
    let (first, second) = (id(&first["id"]), id(&second["id"]));
    let set_id = id(&row(&fixture.json(&["status"]), EMPTY)["setId"]);
    assert_eq!(fixture.saves(&set_id), 3);

    // Two ids: nothing is recorded.
    let between = fixture.json(&["diff", &first[..8], &second[..8]]);
    assert_eq!(between["scalars"][0]["to"], "130");
    assert_eq!(fixture.saves(&set_id), 3);

    // One id: against the latest save of the file it came from, saved first.
    fixture.set_tempo(EMPTY, "150");
    let against_latest = fixture.json(&["diff", &first[..8]]);
    assert_eq!(against_latest["scalars"][0]["from"], "120");
    assert_eq!(against_latest["scalars"][0]["to"], "150");
    assert_eq!(fixture.saves(&set_id), 4);

    // A save id works as well as a commit id.
    let log = fixture.json(&["log", EMPTY]);
    let folded = id(&log["commits"][0]["saves"][0]["id"]);
    let by_save = fixture.json(&["diff", &folded[..8], &first[..8]]);
    assert_eq!(by_save["scalars"][0]["from"], "130");
    assert_eq!(by_save["scalars"][0]["to"], "120");
}

#[test]
fn an_id_prefix_that_is_too_short_or_unknown_is_refused() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let first = id(&fixture.json(&["commit", "-m", "first", EMPTY])["id"]);

    for (args, message) in [
        (
            vec!["diff", &first[..3]],
            format!("Id prefix `{}` is too short.", &first[..3]),
        ),
        (
            vec!["diff", "zzzz"],
            "No commit or save `zzzz`.".to_string(),
        ),
        (
            vec!["diff", &first[..8], "zzzz"],
            "No commit or save `zzzz`.".to_string(),
        ),
        (
            vec!["checkout", "zzzz", "-b", "alt"],
            "No commit `zzzz`.".to_string(),
        ),
        (
            vec!["checkout", "ab", "-b", "alt"],
            "Id prefix `ab` is too short.".to_string(),
        ),
    ] {
        let output = fixture.dit(&args);
        assert_eq!(output.status.code(), Some(1), "{args:?}");
        assert_eq!(stderr(&output), message, "{args:?}");
        assert_eq!(stdout(&output), "", "{args:?}");
    }
}

#[test]
fn an_id_prefix_two_ids_start_is_ambiguous() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let repo = dit_core::Repo::open(&fixture.dir, &dit_daws::registry()).unwrap();

    // Save ids are random hex, so record saves until two share four characters.
    let mut seen = std::collections::HashSet::new();
    let prefix = (100..5_000)
        .find_map(|bpm| {
            fixture.set_tempo(EMPTY, &bpm.to_string());
            let saved = repo
                .record_save(&fixture.set_path(EMPTY))
                .unwrap()
                .expect("a new tempo is a new save")
                .to_string();
            let prefix = saved[..4].to_string();
            (!seen.insert(prefix.clone())).then_some(prefix)
        })
        .expect("two of thousands of ids share four characters");

    let output = fixture.dit(&["diff", &prefix]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), format!("Ambiguous id `{prefix}`."));
}

#[test]
fn saving_twice_records_once() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let set_id = id(&row(&fixture.json(&["status"]), EMPTY)["setId"]);
    assert_eq!(stdout(&fixture.dit(&["save", EMPTY])), "No change");
    assert_eq!(fixture.json(&["save", EMPTY]), json!({ "id": null }));

    fixture.set_tempo(EMPTY, "140");
    let text = stdout(&fixture.dit(&["save", EMPTY]));
    assert_eq!(text.len(), 8, "{text}");
    assert_eq!(fixture.saves(&set_id), 2);
    assert_eq!(stdout(&fixture.dit(&["save", EMPTY])), "No change");
    assert_eq!(fixture.saves(&set_id), 2);

    fixture.set_tempo(EMPTY, "150");
    let json = fixture.json(&["save", EMPTY]);
    assert_eq!(id(&json["id"]).len(), 64);
    assert_eq!(fixture.saves(&set_id), 3);
}

#[test]
fn saving_a_file_that_does_not_decode_is_an_error() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let whole = fs::read(fixture.set_path(EMPTY)).unwrap();
    fs::write(fixture.set_path(EMPTY), &whole[..whole.len() / 2]).unwrap();

    let output = fixture.dit(&["save", EMPTY]);
    assert_eq!(output.status.code(), Some(1));
    assert!(!stderr(&output).is_empty());
    assert_eq!(stdout(&output), "");
}

#[test]
fn checkout_writes_a_branch_file_that_status_lists() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let first = id(&fixture.json(&["commit", "-m", "first", EMPTY])["id"]);
    let set_id = id(&row(&fixture.json(&["status"]), EMPTY)["setId"]);
    let branch_file = "Empty Set @alt.als";
    assert!(!fixture.set_path(branch_file).exists());

    let output = fixture.dit(&["checkout", &first[..8], "-b", "alt"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), branch_file);
    assert!(fixture.set_path(branch_file).is_file());
    assert_eq!(fixture.saves(&set_id), 1, "the new file is not saved yet");

    let status = fixture.json(&["status"]);
    let alt = row(&status, branch_file);
    assert_eq!(alt["branch"], "alt");
    assert_eq!(alt["setId"], set_id.as_str());
    assert_eq!(row(&status, EMPTY)["branch"], "main");

    let second = fixture.json(&["checkout", &first[..8], "-b", "other"]);
    assert_eq!(
        second,
        json!({ "file": "Empty Set @other.als", "branch": "other", "setId": set_id })
    );
}

#[test]
fn checkout_onto_an_existing_branch_or_a_missing_b_writes_nothing() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let first = id(&fixture.json(&["commit", "-m", "first", EMPTY])["id"]);
    fixture.json(&["checkout", &first[..8], "-b", "alt"]);
    let before = files(&fixture);

    let output = fixture.dit(&["checkout", &first[..8], "-b", "alt"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("alt"), "{}", stderr(&output));
    assert_eq!(files(&fixture), before);

    let output = fixture.dit(&["checkout", &first[..8], "-b", "main"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(files(&fixture), before);

    let output = fixture.dit(&["checkout", &first[..8]]);
    assert_eq!(output.status.code(), Some(2), "clap refuses a missing -b");
    assert_eq!(files(&fixture), before);
}

#[test]
fn checkout_takes_commit_ids_only() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "-m", "first", EMPTY]);
    let log = fixture.json(&["log", EMPTY]);
    let save = id(&log["commits"][0]["saves"][0]["id"]);

    // The commit's own save is a save, not a commit.
    let output = fixture.dit(&["checkout", &save[..8], "-b", "alt"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), format!("No commit `{}`.", &save[..8]));
}

#[test]
fn a_project_with_no_sets_has_nothing_to_log_or_commit() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("Bare Project");
    fs::create_dir(&dir).unwrap();
    let home = root.path();
    assert!(run(&dir, home, &["init"]).status.success());

    for command in [&["log"][..], &["commit"][..]] {
        let output = run(&dir, home, command);
        assert_eq!(output.status.code(), Some(1), "{command:?}");
        assert_eq!(stderr(&output), "No sets in this repo.", "{command:?}");
    }
    assert_eq!(
        stdout(&run(&dir, home, &["status"])),
        "No sets in this repo."
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&run(&dir, home, &["status", "--json"]).stdout).unwrap(),
        json!({ "sets": [] })
    );
}

fn no_instance() -> String {
    RemoteError::NoInstance.to_string()
}

#[test]
fn commit_with_no_push_leaves_the_push_fields_out() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let result = fixture.json(&["commit", "--no-push", "-m", "first", EMPTY]);
    assert!(result.get("pushed").is_none(), "{result}");
    assert!(result.get("pushError").is_none(), "{result}");
}

#[test]
fn a_commit_stands_when_the_push_after_it_fails() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let result = fixture.json(&["commit", "-m", "first", EMPTY]);
    assert_eq!(result["pushError"], no_instance());
    assert!(result.get("pushed").is_none(), "{result}");
    assert_eq!(
        fixture.json(&["log", EMPTY])["commits"][0]["message"],
        "first"
    );

    fixture.set_tempo(EMPTY, "140");
    let output = fixture.dit(&["commit", "-m", "second", EMPTY]);
    assert!(output.status.success(), "{}", stderr(&output));
    let lines: Vec<String> = stdout(&output).lines().map(str::to_string).collect();
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(lines[0].ends_with("] second"), "{lines:?}");
    assert_eq!(
        lines[1],
        format!(
            "{} The commit is kept here; run dit push to send it.",
            no_instance()
        )
    );
}

#[test]
fn push_fails_cleanly_when_signed_in_to_no_instance() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    for args in [&["push"][..], &["push", EMPTY][..]] {
        let output = fixture.dit(args);
        assert_eq!(output.status.code(), Some(1), "{args:?}");
        assert_eq!(stderr(&output), no_instance(), "{args:?}");
        assert_eq!(stdout(&output), "", "{args:?}");
    }
}

#[test]
fn restore_fails_cleanly_when_signed_in_to_no_instance_and_takes_a_numeric_commit_id() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let output = fixture.dit(&["restore", "812", "--name", "other"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), no_instance());
    assert_eq!(stdout(&output), "");

    let output = fixture.dit(&["restore", "abc123"]);
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn push_of_an_unknown_set_names_it() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let output = fixture.dit(&["push", "Nope"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), "No set named `Nope`.");
}

#[test]
fn remote_set_on_a_repo_never_pushed_is_refused() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let output = fixture.dit(&["remote", "set", "https://hub.example.com"]);

    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stderr(&output), RebindError::NotBound.to_string());
    assert_eq!(stdout(&output), "");
}

#[test]
fn remote_set_refuses_an_address_that_is_not_an_instance_and_keeps_the_binding() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    let config = fixture.dir.join(".dit/config.toml");
    let mut text = fs::read_to_string(&config).unwrap();
    text.push_str("\n[remote]\ninstance = \"http://hub.example\"\nrepo = 1\n");
    fs::write(&config, &text).unwrap();

    let output = fixture.dit(&["remote", "set", "hub.example"]);

    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        stderr(&output),
        RemoteError::BadInstance("hub.example".to_string()).to_string()
    );
    assert_eq!(fs::read_to_string(&config).unwrap(), text);
}

#[test]
fn status_counts_what_is_pending_for_an_unbound_repo() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first", EMPTY]);

    let status = fixture.json(&["status"]);
    let empty = row(&status, EMPTY);
    assert_eq!(empty["pendingSaves"], 1);
    assert_eq!(empty["pendingCommits"], 1);
    let arranged = row(&status, ARRANGED);
    assert_eq!(arranged["pendingSaves"], 1);
    assert_eq!(arranged["pendingCommits"], 0);

    let text = stdout(&fixture.dit(&["status", EMPTY]));
    assert!(text.ends_with(", 1 save and 1 commit to push"), "{text}");
}

#[test]
fn status_of_one_set_lists_and_counts_only_that_set() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first", EMPTY]);

    let status = fixture.json(&["status", ARRANGED]);

    let sets = status["sets"].as_array().unwrap();
    assert_eq!(sets.len(), 1);
    let arranged = row(&status, ARRANGED);
    assert_eq!(arranged["pendingSaves"], 1);
    assert_eq!(arranged["pendingCommits"], 0);
}

#[test]
fn status_of_one_set_does_not_read_what_a_push_recorded_for_another() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first", EMPTY]);
    let empty = id(&row(&fixture.json(&["status"]), EMPTY)["setId"]);
    let config = fixture.dir.join(".dit/config.toml");
    let mut text = fs::read_to_string(&config).unwrap();
    text.push_str("\n[remote]\ninstance = \"http://hub.example\"\nrepo = 1\n");
    fs::write(&config, text).unwrap();
    let pushed = fixture.dir.join(".dit/refs/remote");
    fs::create_dir_all(&pushed).unwrap();
    fs::write(pushed.join(format!("{empty}.json")), "not json").unwrap();

    let status = fixture.json(&["status", ARRANGED]);

    assert_eq!(status["sets"].as_array().unwrap().len(), 1);
    assert_eq!(row(&status, ARRANGED)["pendingSaves"], 1);
    let everything = fixture.dit(&["status"]);
    assert!(
        !everything.status.success(),
        "the unreadable file is read for the other set"
    );
}

/// A set that references `Samples/Imported/kick.wav` (inside the project) and a library sample.
fn write_set_with_samples(fixture: &Fixture) {
    let path = fixture.set_path(EMPTY);
    let xml = String::from_utf8(Ableton.decode(&fs::read(&path).unwrap()).unwrap()).unwrap();
    let refs = r#"<SampleRef><FileRef><RelativePathType Value="3" /><RelativePath Value="Samples/Imported/kick.wav" /><Path Value="/Users/demo/Project/Samples/Imported/kick.wav" /></FileRef></SampleRef><SampleRef><FileRef><RelativePathType Value="5" /><Path Value="/Library/pad.wav" /></FileRef></SampleRef>"#;
    assert!(xml.contains("<Tracks>"));
    let edited = xml.replacen("<Tracks>", &format!("<Tracks>{refs}"), 1);
    fs::write(&path, Ableton.encode(edited.as_bytes()).unwrap()).unwrap();
}

fn read_repo(fixture: &Fixture) -> dit_core::Repo {
    let registry = dit_core::Registry::new(vec![&Ableton]).unwrap();
    dit_core::Repo::open(&fixture.dir, &registry).unwrap()
}

#[test]
fn a_save_tracks_the_samples_folder_bytes_and_keeps_every_other_reference_unread() {
    let fixture = Fixture::new();
    let kick = fixture.dir.join("Samples/Imported/kick.wav");
    fs::create_dir_all(kick.parent().unwrap()).unwrap();
    fs::write(&kick, b"kick bytes").unwrap();
    write_set_with_samples(&fixture);

    let status = fixture.json(&["init"]);
    assert!(status["sets"].is_array());

    let repo = read_repo(&fixture);
    let set = repo.sets().unwrap();
    let (set_id, _) = set.iter().find(|(_, file)| file.as_str() == EMPTY).unwrap();
    let save = repo.saves(set_id, "main").unwrap().pop().unwrap();
    assert_eq!(save.samples.len(), 2);
    let tracked = &save.samples[0];
    assert_eq!(
        tracked.relative.as_deref(),
        Some("Samples/Imported/kick.wav")
    );
    assert_eq!(tracked.size, Some(10));
    assert_eq!(
        repo.store().read_leaf(&tracked.object.unwrap()).unwrap(),
        b"kick bytes"
    );
    assert_eq!((save.samples[1].object, save.samples[1].size), (None, None));
    assert!(fixture.dir.join(".dit/samples.json").is_file());
}

#[test]
fn a_replaced_sample_is_a_save_that_can_be_committed() {
    let fixture = Fixture::new();
    let kick = fixture.dir.join("Samples/Imported/kick.wav");
    fs::create_dir_all(kick.parent().unwrap()).unwrap();
    fs::write(&kick, b"kick bytes").unwrap();
    write_set_with_samples(&fixture);
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first", EMPTY]);
    assert_eq!(
        row(&fixture.json(&["status", EMPTY]), EMPTY)["savesSinceCommit"],
        0
    );

    fs::write(&kick, b"a different kick").unwrap();
    let status = fixture.json(&["status", EMPTY]);

    let empty = row(&status, EMPTY);
    assert_eq!(empty["savesSinceCommit"], 1);
    assert_eq!(empty["workingChanged"], true);
    // A sample-only change has no tree difference; the default message names the file.
    let commit = fixture.json(&["commit", "--no-push", EMPTY]);
    assert_eq!(commit["message"], "Replaced sample kick.wav");
    assert_eq!(commit["diff"]["samplesReplaced"], json!(["kick.wav"]));
    let again = fixture.dit(&["commit", "--no-push", "-m", "again", EMPTY]);
    assert_eq!(again.status.code(), Some(1));
    assert_eq!(
        stderr(&again),
        "Nothing to commit since 'Replaced sample kick.wav'."
    );
}

#[test]
fn time_reports_the_spans_the_app_kept_in_all_since_the_last_commit_and_per_commit() {
    const MINUTE: u64 = 60;
    let fixture = Fixture::new();
    fixture.set_modified(EMPTY, 60 * MINUTE);
    fixture.dit(&["init"]);
    fixture.dit(&["commit", "--no-push", "-m", "first idea", EMPTY]);
    fixture.set_tempo(EMPTY, "140");
    fixture.set_modified(EMPTY, 120 * MINUTE);
    fixture.dit(&["commit", "--no-push", "-m", "second idea", EMPTY]);
    let set_id = id(&row(&fixture.json(&["status", EMPTY]), EMPTY)["setId"]);
    // What the app writes while it runs: spans of minutes since the epoch, a JSON object a line.
    let line = |start: u64, end: u64| {
        format!(
            "{{\"start\":{},\"end\":{},\"source\":\"script\"}}\n",
            start * MINUTE * 1000,
            end * MINUTE * 1000
        )
    };
    let time = fixture.dir.join(".dit/time").join(&set_id);
    fs::create_dir_all(&time).unwrap();
    fs::write(time.join("main"), line(30, 90) + &line(150, 200)).unwrap();

    let text = stdout(&fixture.dit(&["time", EMPTY]));

    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines[0],
        format!("{EMPTY} (main): 1h 50m in the set, 50m since the last commit")
    );
    assert!(lines[1].ends_with("second idea  30m"), "{text}");
    assert!(lines[2].ends_with("first idea  30m"), "{text}");
    let json = fixture.json(&["time", EMPTY]);
    let row = &json["sets"][0];
    assert_eq!(row["totalMs"], 110 * 60_000);
    assert_eq!(row["sinceCommitMs"], 50 * 60_000);
    assert_eq!(row["commits"][0]["message"], "second idea");
    assert_eq!(row["commits"][0]["ms"], 30 * 60_000);
    let other = stdout(&fixture.dit(&["time", ARRANGED]));
    assert_eq!(
        other,
        format!("{ARRANGED} (main): <1m in the set, no commits yet")
    );
}

#[test]
fn config_push_samples_alone_prints_the_setting_and_a_repo_never_heard_from_is_local_only() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    assert_eq!(
        stdout(&fixture.dit(&["config", "push-samples"])),
        "samples: local only"
    );
    assert_eq!(
        fixture.json(&["config", "push-samples"]),
        json!({ "samples": "localOnly" })
    );
}

#[test]
fn config_push_samples_reads_the_cache_a_push_wrote() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    for (cache, says, mode) in [
        (
            "enabled = true\nforced = false",
            "samples: pushed",
            "pushed",
        ),
        (
            "enabled = false\nforced = true",
            "samples: pushed (instance)",
            "instance",
        ),
        (
            "enabled = false\nforced = false",
            "samples: local only",
            "localOnly",
        ),
    ] {
        let config = fixture.dir.join(".dit/config.toml");
        let text = fs::read_to_string(&config).unwrap();
        let text = text.split("[push_samples]").next().unwrap().to_string();
        fs::write(&config, format!("{text}\n[push_samples]\n{cache}\n")).unwrap();

        assert_eq!(stdout(&fixture.dit(&["config", "push-samples"])), says);
        assert_eq!(fixture.json(&["config", "push-samples"])["samples"], mode);
        assert!(
            stdout(&fixture.dit(&["status"])).ends_with(says),
            "status ends with the setting"
        );
        assert_eq!(fixture.json(&["status"])["samples"], mode);
    }
}

#[test]
fn status_says_nothing_of_samples_until_the_setting_has_been_heard() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    assert!(!stdout(&fixture.dit(&["status"])).contains("samples"));
    let status = fixture.json(&["status"]);
    assert!(status.get("samples").is_none());
    assert_eq!(row(&status, EMPTY)["pendingSamples"], 0);
}

#[test]
fn setting_push_samples_on_a_repo_that_was_never_pushed_says_to_push_first() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    for value in ["on", "off"] {
        let output = fixture.dit(&["config", "push-samples", value]);
        assert_eq!(output.status.code(), Some(1));
        assert_eq!(
            stderr(&output),
            "This repo has not been pushed yet. Run dit push first."
        );
    }
}

#[test]
fn config_push_samples_takes_only_on_or_off() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);

    let output = fixture.dit(&["config", "push-samples", "maybe"]);

    assert!(!output.status.success());
    assert_ne!(output.status.code(), Some(0));
}

#[test]
fn script_install_puts_the_files_in_the_user_library_and_status_reads_them_back() {
    let fixture = Fixture::new();
    let folder = fixture
        .home
        .join("Music/Ableton/User Library/Remote Scripts/dit");

    let before = fixture.json(&["script", "status"]);
    assert_eq!(before["scripts"][0]["installed"], false);
    assert!(!folder.exists());

    let first = fixture.json(&["script", "install"]);
    assert_eq!(
        first["scripts"][0]["written"], 4,
        "three files and the VERSION marker"
    );
    for name in ["__init__.py", "protocol.py", "tracks.py", "VERSION"] {
        assert!(folder.join(name).is_file(), "{name}");
    }
    let second = fixture.json(&["script", "install"]);
    assert_eq!(second["scripts"][0]["written"], 0);

    let status = fixture.json(&["script", "status"]);
    assert_eq!(status["scripts"][0]["installed"], true);
    assert_eq!(status["scripts"][0]["current"], true);
    assert_eq!(
        status["scripts"][0]["enabled"],
        Value::Null,
        "no Live has run under this home"
    );
    let text = stdout(&fixture.dit(&["script", "status"]));
    assert!(
        text.starts_with("Ableton Live: installed, version 2"),
        "{text}"
    );
    assert!(text.contains("connected: needs the dit app"), "{text}");
}

/// What `dit renders` reads and writes, as the cli sees it with the dit app not running.
mod renders {
    use dit_daemon::renders::ledger::{Ledger, ProposalFile, ProposalState};
    use dit_daemon::renders::probe::fingerprint;

    use super::*;

    impl Fixture {
        fn ledger_path(&self) -> PathBuf {
            let folder = if cfg!(target_os = "macos") {
                self.home.join("Library/Application Support/dit")
            } else {
                self.home.join("dit")
            };
            folder.join("renders.json")
        }

        /// Writes `files` (name and size) in the project's `Bounces` folder and a proposal of them; returns its id.
        fn propose(
            &self,
            name: &str,
            files: &[(&str, usize)],
            state: ProposalState,
            session: Option<i64>,
        ) -> u64 {
            let folder = self.dir.join("Bounces");
            fs::create_dir_all(&folder).unwrap();
            let found: Vec<ProposalFile> = files
                .iter()
                .map(|(file, size)| {
                    let path = folder.join(file);
                    let bytes: Vec<u8> = (0..*size).map(|at| (at * 31 % 251) as u8).collect();
                    fs::write(&path, bytes).unwrap();
                    ProposalFile {
                        path,
                        size: *size as u64,
                        mtime_ms: 0,
                        fingerprint: None,
                    }
                })
                .collect();
            Ledger::update(&self.ledger_path(), |ledger| {
                let id = ledger.propose(name, found, 0);
                let proposal = ledger.by_id_mut(id).unwrap();
                proposal.state = state;
                proposal.session_id = session;
                id
            })
            .unwrap()
        }

        fn ledger(&self) -> Ledger {
            Ledger::load(&self.ledger_path()).unwrap()
        }
    }

    const STALE: &str = "The dit app isn't running; this list may be out of date.";

    #[test]
    fn the_list_is_read_from_the_ledger_and_ends_with_the_stale_line() {
        let fixture = Fixture::new();
        fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096), ("Canopy v3.mp3", 1024)],
            ProposalState::Proposed,
            Some(5),
        );
        fixture.propose(
            "Intro",
            &[("Intro.wav", 100)],
            ProposalState::Added,
            Some(5),
        );

        let output = fixture.dit(&["renders"]);

        assert!(output.status.success(), "{}", stderr(&output));
        assert_eq!(
            stdout(&output),
            format!(
                "1 proposed Canopy v3 (2 files, 5.0 KB)\n2 added Intro (1 file, 100 B)\n{STALE}"
            )
        );
    }

    #[test]
    fn json_is_the_array_of_cards_and_the_stale_line_goes_to_stderr() {
        let fixture = Fixture::new();
        fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096), ("Canopy v3.mp3", 1024)],
            ProposalState::QueuedOffline,
            Some(5),
        );

        let output = fixture.dit(&["renders", "--json"]);

        assert!(output.status.success(), "{}", stderr(&output));
        let cards: Value = serde_json::from_slice(&output.stdout).unwrap();
        let cards = cards.as_array().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0]["id"], 1);
        assert_eq!(cards[0]["state"], "queued-offline");
        assert_eq!(cards[0]["sessionId"], 5);
        assert_eq!(cards[0]["files"].as_array().unwrap().len(), 2);
        assert!(stderr(&output).contains(STALE), "{}", stderr(&output));
    }

    #[test]
    fn an_empty_ledger_says_so_and_still_says_the_app_is_not_running() {
        let fixture = Fixture::new();
        assert_eq!(
            stdout(&fixture.dit(&["renders"])),
            format!("No renders.\n{STALE}")
        );
    }

    #[test]
    fn reject_never_here_writes_the_ledger_directly() {
        let fixture = Fixture::new();
        let id = fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096)],
            ProposalState::Proposed,
            Some(5),
        );
        let file = fixture.dir.join("Bounces").join("Canopy v3.wav");

        let output = fixture.dit(&["renders", "reject", &id.to_string(), "--never-here"]);

        assert!(output.status.success(), "{}", stderr(&output));
        let text = stdout(&output);
        assert!(
            text.starts_with("Rejected Canopy v3 as not a bounce."),
            "{text}"
        );
        assert!(text.contains("Bounces"), "{text}");
        let ledger = fixture.ledger();
        assert_eq!(ledger.by_id(id).unwrap().state, ProposalState::Rejected);
        assert!(ledger.is_rejected(&fingerprint(&file).unwrap()));
        assert!(ledger.is_never_here(&file));
        assert!(
            !stdout(&fixture.dit(&["renders"])).contains("Canopy v3"),
            "a rejected render is not listed"
        );

        let again = fixture.dit(&["renders", "reject", &id.to_string()]);
        assert!(!again.status.success());
        assert!(
            stderr(&again).contains("rejected already"),
            "{}",
            stderr(&again)
        );
    }

    #[test]
    fn reject_without_never_here_leaves_the_folder_open() {
        let fixture = Fixture::new();
        let id = fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096)],
            ProposalState::Proposed,
            None,
        );
        let output = fixture.dit(&["renders", "reject", &id.to_string()]);
        assert!(output.status.success(), "{}", stderr(&output));
        assert_eq!(stdout(&output), "Rejected Canopy v3 as not a bounce.");
        assert!(fixture.ledger().never_here.is_empty());
    }

    #[test]
    fn accepting_or_rejecting_a_render_that_does_not_exist_is_an_error() {
        let fixture = Fixture::new();
        for command in ["accept", "reject"] {
            let output = fixture.dit(&["renders", command, "9"]);
            assert!(!output.status.success());
            assert_eq!(stderr(&output), "There is no render 9.");
            assert_eq!(stdout(&output), "");
        }
    }

    #[test]
    fn accepting_a_render_with_no_session_says_to_name_one() {
        let fixture = Fixture::new();
        let id = fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096)],
            ProposalState::Proposed,
            None,
        );
        let output = fixture.dit(&["renders", "accept", &id.to_string()]);
        assert!(!output.status.success());
        assert!(stderr(&output).contains("--set"), "{}", stderr(&output));
        assert_eq!(
            fixture.ledger().by_id(id).unwrap().state,
            ProposalState::Proposed
        );
    }

    #[test]
    fn accepting_while_signed_out_leaves_the_render_queued_for_the_app() {
        let fixture = Fixture::new();
        let id = fixture.propose(
            "Canopy v3",
            &[("Canopy v3.wav", 4096)],
            ProposalState::Proposed,
            None,
        );

        let output = fixture.dit(&["renders", "accept", &id.to_string(), "--set", "5"]);

        assert!(!output.status.success());
        assert!(
            stderr(&output).contains("stays queued"),
            "{}",
            stderr(&output)
        );
        let held = fixture.ledger().by_id(id).unwrap().clone();
        assert_eq!(held.state, ProposalState::QueuedOffline);
        assert_eq!(held.session_id, Some(5), "the session named is kept");
    }
}

mod backfill {
    use super::*;

    impl Fixture {
        /// The folder the fixture project sits in, which a search of finds it.
        fn search_root(&self) -> String {
            self.dir.parent().unwrap().to_str().unwrap().to_string()
        }

        /// The fixture's sets, one saved long before the other.
        fn dated(&self) {
            self.set_modified(EMPTY, 1_000_000_000);
            self.set_modified(ARRANGED, 1_710_000_000);
        }

        fn set_bytes(&self) -> u64 {
            [EMPTY, ARRANGED]
                .iter()
                .map(|name| fs::metadata(self.set_path(name)).unwrap().len())
                .sum()
        }
    }

    #[test]
    fn listing_a_folder_prints_a_line_for_each_project_in_it() {
        let fixture = Fixture::new();
        fixture.dated();
        let root = fixture.search_root();

        let output = fixture.dit(&["backfill", "--in", &root]);

        assert!(output.status.success(), "{}", stderr(&output));
        let project = fixture.dir.canonicalize().unwrap();
        let text = stdout(&output);
        assert!(
            text.starts_with(&format!("{}  2 sets  ", project.display())),
            "{text}"
        );
        assert!(text.ends_with("  last saved 9 Mar 2024"), "{text}");
        assert_eq!(text.lines().count(), 1, "{text}");
    }

    #[test]
    fn listing_as_json_is_an_array_of_what_each_folder_holds() {
        let fixture = Fixture::new();
        fixture.dated();

        let listed = fixture.json(&["backfill", "--in", &fixture.search_root()]);

        assert_eq!(
            listed,
            json!([{
                "path": fixture.dir.canonicalize().unwrap().to_str().unwrap(),
                "sets": 2,
                "bytes": fixture.set_bytes(),
                "newest": 1_710_000_000_000i64,
                "already": false,
                "syncedBy": null,
            }])
        );
    }

    #[test]
    fn a_folder_that_dit_init_made_a_repo_is_listed_as_already_in_dit() {
        let fixture = Fixture::new();
        fixture.dated();
        fixture.dit(&["init"]);
        let root = fixture.search_root();

        let output = fixture.dit(&["backfill", "--in", &root]);

        assert!(
            stdout(&output).ends_with("  last saved 9 Mar 2024 · already in dit"),
            "{}",
            stdout(&output)
        );
        let listed = fixture.json(&["backfill", "--in", &root]);
        assert_eq!(listed[0]["already"], true);
        assert_eq!(
            listed[0]["bytes"],
            fixture.set_bytes(),
            "the .dit folder is not counted"
        );
    }

    #[test]
    fn a_search_that_finds_no_project_says_so_in_text_and_lists_none_in_json() {
        let fixture = Fixture::new();
        let empty = fixture.home.to_str().unwrap().to_string();

        let output = fixture.dit(&["backfill", "--in", &empty]);

        assert_eq!(stdout(&output), "No Live projects found.");
        assert_eq!(fixture.json(&["backfill", "--in", &empty]), json!([]));
    }

    #[test]
    fn a_root_that_does_not_exist_is_left_out_of_the_search() {
        let fixture = Fixture::new();
        let missing = fixture.home.join("nowhere");

        let output = fixture.dit(&[
            "backfill",
            "--in",
            missing.to_str().unwrap(),
            "--in",
            &fixture.search_root(),
        ]);

        assert!(output.status.success(), "{}", stderr(&output));
        assert_eq!(stdout(&output).lines().count(), 1);
    }

    #[test]
    fn with_no_root_named_music_under_the_home_folder_is_searched() {
        let fixture = Fixture::new();
        let folder = fixture.home.join("Music").join("Demo Project");
        fs::create_dir_all(&folder).unwrap();
        fs::copy(fixture.set_path(EMPTY), folder.join(EMPTY)).unwrap();

        let output = fixture.dit(&["backfill"]);

        assert!(output.status.success(), "{}", stderr(&output));
        assert!(
            stdout(&output).starts_with("~/Music/Demo Project  1 set  "),
            "{}",
            stdout(&output)
        );
    }

    #[test]
    fn folders_and_roots_cannot_be_given_together() {
        let fixture = Fixture::new();

        let output = fixture.dit(&["backfill", "--in", &fixture.search_root(), "Some Project"]);

        assert!(!output.status.success());
    }

    #[test]
    fn bringing_folders_in_when_signed_in_to_no_instance_fails_before_reading_anything() {
        let fixture = Fixture::new();

        let output = fixture.dit(&["backfill", "."]);

        assert_eq!(output.status.code(), Some(1));
        assert_eq!(stderr(&output), no_instance());
        assert_eq!(stdout(&output), "");
        assert!(!fixture.dir.join(".dit").exists());
    }
}
