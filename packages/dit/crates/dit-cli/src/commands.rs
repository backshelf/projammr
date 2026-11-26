//! One function per command. Each opens the repo, calls `dit-core` and returns a
//! result `output` can print as text or JSON; no repo logic lives here.

use std::fmt;
use std::path::Path;

use dit_core::remote::{self, Pending, PushOptions};
use dit_core::{
    Commit, CommitKind, DiffSummary, ObjectId, Repo, RepoError, RepoList, Save, summary_line,
};
use dit_daws::registry;
use serde::Serialize;

use crate::config::SamplesMode;
use crate::context::Context;
use crate::push::{PushResult, push_to_hub};

/// An error for the terminal: one line on stderr and exit code 1.
#[derive(Debug)]
pub struct CliError(pub String);

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<RepoError> for CliError {
    fn from(error: RepoError) -> Self {
        match error {
            RepoError::NotARepo(_) => {
                CliError("Not a dit repo. Run dit init in a Live project folder.".to_string())
            }
            other => CliError(other.to_string()),
        }
    }
}

impl From<std::io::Error> for CliError {
    fn from(error: std::io::Error) -> Self {
        CliError(error.to_string())
    }
}

/// A file dit keeps saves of: a set's own file on `main`, or the file of one of
/// its other branches.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingFile {
    pub set_id: String,
    /// Relative to the project folder, `/` separated.
    pub file: String,
    pub branch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    pub root: String,
    pub daw: String,
    pub sets: Vec<WorkingFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusRow {
    pub set_id: String,
    pub file: String,
    pub branch: String,
    pub saves_since_commit: usize,
    pub working_changed: bool,
    /// Saves and commits on this branch the hub does not hold yet.
    pub pending_saves: usize,
    pub pending_commits: usize,
    /// Commits whose sample objects the next push would send, when the repo's hub takes samples.
    pub pending_samples: usize,
}

#[derive(Serialize)]
pub struct StatusResult {
    pub sets: Vec<StatusRow>,
    /// The push-samples setting as last heard from the instance; absent until a push or `dit config` has heard it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<SamplesMode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSave {
    pub id: String,
    pub at: i64,
    pub view_only: bool,
}

#[derive(Serialize)]
pub struct LogCommit {
    pub id: String,
    pub message: String,
    pub author: String,
    pub at: i64,
    pub kind: CommitKind,
    pub saves: Vec<LogSave>,
}

#[derive(Serialize)]
pub struct LogResult {
    pub commits: Vec<LogCommit>,
}

/// What changed between two saves: the summary as JSON, and the one line that words it, which `dit commit` uses
/// as its default message.
#[derive(Serialize)]
pub struct DiffResult {
    #[serde(flatten)]
    pub diff: DiffSummary,
    #[serde(skip)]
    pub line: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub id: String,
    pub message: String,
    /// `None` for the first commit of a branch.
    pub diff: Option<DiffSummary>,
    #[serde(skip)]
    pub branch: String,
    /// The push after the commit; `None` with `--no-push` or when it failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pushed: Option<PushResult>,
    /// Why the push after the commit did not happen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push_error: Option<String>,
    /// Whether `push_error` needs the note that the commit is kept here.
    #[serde(skip)]
    pub push_error_needs_note: bool,
    /// The push sent the commit but not its samples, which the repo's setting asks for: `dit push` sends them.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub samples_pending: bool,
}

#[derive(Serialize)]
pub struct SaveResult {
    /// The new save's id; `None` when the file had not changed.
    pub id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutResult {
    /// The new branch's working file, relative to the project folder.
    pub file: String,
    pub branch: String,
    pub set_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeCommit {
    pub id: String,
    pub message: String,
    /// Milliseconds the set was open in this commit's window.
    pub ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRow {
    pub set_id: String,
    pub file: String,
    pub branch: String,
    /// Milliseconds the set was open, all told.
    pub total_ms: i64,
    /// Milliseconds since the branch's head commit; all of it when there is none.
    pub since_commit_ms: i64,
    /// The branch's commits, newest first.
    pub commits: Vec<TimeCommit>,
}

#[derive(Serialize)]
pub struct TimeResult {
    pub sets: Vec<TimeRow>,
}

/// Makes the current folder, or its parent when that is the project folder, a
/// repo and records a save of every set in it. Safe to run again: it opens the
/// repo that is there and records what changed.
pub fn init(cx: &mut Context, cwd: &Path) -> Result<InitResult, CliError> {
    let registry = registry();
    let (dir, daw) = std::iter::once(cwd)
        .chain(cwd.parent())
        .find_map(|dir| registry.for_project_folder(dir).map(|daw| (dir, daw)))
        .ok_or_else(|| CliError("Not a Live project folder.".to_string()))?;
    let repo = Repo::init(dir, daw)?.with_machine(cx.saving_machine());
    for path in daw.find_sets(repo.root())? {
        record(cx, &repo, &path)?;
    }
    // The dit app tracks the repos in this list. A list that cannot be written must not fail `init`.
    if let Ok(config) = cx.remote.config_path() {
        let _ = RepoList::update(&config.with_file_name("repos.toml"), |list| {
            list.add(repo.root())
        });
    }
    Ok(InitResult {
        root: repo.root().display().to_string(),
        daw: daw.id().to_string(),
        sets: working_files(&repo)?,
    })
}

/// Records a save of each working file, then reports how far each is from its
/// last commit. With no set named, a set file that appeared in the project
/// since the last command is recorded too, so it joins the list as a new set.
pub fn status(cx: &mut Context, cwd: &Path, set: Option<&str>) -> Result<StatusResult, CliError> {
    let repo = open(cx, cwd)?;
    let files = match set {
        Some(name) => {
            let file = resolve(&working_files(&repo)?, name)?;
            record_working(cx, &repo, &file)?;
            vec![file]
        }
        None => {
            for path in repo.daw().find_sets(repo.root())? {
                record(cx, &repo, &path)?;
            }
            working_files(&repo)?
        }
    };
    let only_set = match (set, files.as_slice()) {
        (Some(_), [file]) => Some(file.set_id.as_str()),
        _ => None,
    };
    let pending = remote::pending(&repo, only_set)?;
    let sets = files
        .into_iter()
        .map(|file| status_row(&repo, file, &pending))
        .collect::<Result<_, _>>()?;
    Ok(StatusResult {
        sets,
        samples: repo.push_samples()?.map(SamplesMode::from),
    })
}

/// The commits of a set's branch, newest first, with the saves folded under
/// each.
pub fn log(cx: &mut Context, cwd: &Path, set: Option<&str>) -> Result<LogResult, CliError> {
    let repo = open(cx, cwd)?;
    let file = target(cx, &repo, set, false)?;
    let commits = repo
        .history(&file.set_id, &file.branch)?
        .into_iter()
        .map(|entry| LogCommit {
            id: entry.id.to_string(),
            message: entry.commit.message,
            author: entry.commit.author,
            at: entry.commit.at,
            kind: entry.commit.kind,
            saves: entry
                .saves
                .iter()
                .map(|(id, save)| LogSave {
                    id: id.to_string(),
                    at: save.file_updated_at,
                    view_only: save.view_only,
                })
                .collect(),
        })
        .collect();
    Ok(LogResult { commits })
}

/// Records a save of the set, then commits its latest one. With no message the
/// summary line of what changed since the branch head names the commit.
pub fn commit(
    cx: &mut Context,
    cwd: &Path,
    message: Option<&str>,
    set: Option<&str>,
    no_push: bool,
) -> Result<CommitResult, CliError> {
    let repo = open(cx, cwd)?;
    let file = target(cx, &repo, set, true)?;
    let latest = latest_save(&repo, &file)?;
    let head_commit = head(&repo, &file)?;
    let compared = match (&head_commit, &latest) {
        (Some((_, head_save)), Some((_, latest_save))) => compare(&repo, head_save, latest_save)?,
        _ => None,
    };
    let message = match (message, &compared, &head_commit) {
        (Some(message), _, _) => message.to_string(),
        (None, Some((_, line)), _) => line.clone(),
        (None, None, Some(_)) => "Unreadable save".to_string(),
        (None, None, None) => dit_core::INITIAL_COMMIT.to_string(),
    };
    let diff = compared.map(|(diff, _)| diff);
    let id = repo.commit(
        &file.set_id,
        &file.branch,
        &message,
        &cx.author(),
        CommitKind::User,
    )?;
    let (mut pushed, mut push_error, mut push_error_needs_note) = (None, None, false);
    let mut samples_pending = false;
    if !no_push {
        let options = PushOptions {
            set: Some(file.set_id.clone()),
            project: None,
            // The commit is what the push is for; its samples can take a long time.
            skip_samples: true,
            saves_only: false,
        };
        match push_to_hub(cx, &repo, &options) {
            Ok(result) => {
                samples_pending = remote::pending(&repo, Some(&file.set_id))?
                    .iter()
                    .any(|pending| pending.branch == file.branch && pending.samples > 0);
                pushed = Some(result);
            }
            Err(failure) => {
                push_error_needs_note = !failure.says_kept();
                push_error = Some(failure.to_string());
            }
        }
    }
    Ok(CommitResult {
        id: id.to_string(),
        message,
        diff,
        branch: file.branch,
        pushed,
        push_error,
        push_error_needs_note,
        samples_pending,
    })
}

/// What changed between two saves. With no ids, from the branch head's save to
/// the latest save of the working file. With one, from that save to the latest
/// save of the file it was recorded from. With two, from the first to the
/// second, recording nothing.
pub fn diff(
    cx: &mut Context,
    cwd: &Path,
    a: Option<&str>,
    b: Option<&str>,
    set: Option<&str>,
) -> Result<DiffResult, CliError> {
    let repo = open(cx, cwd)?;
    let (from, to) = match (a, b) {
        (Some(a), Some(b)) => (resolve_id(&repo, a)?, resolve_id(&repo, b)?),
        (Some(a), None) => {
            let from = resolve_id(&repo, a)?;
            let file = working_files(&repo)?
                .into_iter()
                .find(|file| file.set_id == from.set_id && file.branch == from.branch)
                .ok_or_else(|| CliError(format!("No working file for `{a}`.")))?;
            record_working(cx, &repo, &file)?;
            (from, latest_of(&repo, &file)?)
        }
        (None, _) => {
            let file = target(cx, &repo, set, true)?;
            let (_, head_save) = head(&repo, &file)?
                .ok_or_else(|| CliError(format!("`{}` has no commits yet.", file.file)))?;
            (head_save, latest_of(&repo, &file)?)
        }
    };
    let (diff, line) = compare(&repo, &from, &to)?.ok_or(RepoError::NoDocument)?;
    Ok(DiffResult { diff, line })
}

/// Records a save of the set's working file and reports its id, or that
/// nothing had changed. Unlike the lazy saves of the other commands, a file
/// that does not decode is an error: the save was asked for. With no `<set>`
/// the file is the one most recently modified on disk, since the recorded
/// saves cannot know which file Live wrote last.
pub fn save(cx: &mut Context, cwd: &Path, set: Option<&str>) -> Result<SaveResult, CliError> {
    let repo = open(cx, cwd)?;
    let file = match set {
        Some(_) => target(cx, &repo, set, false)?,
        None => newest_on_disk(cx, &repo)?,
    };
    let recorded = repo.record_save(&repo.root().join(&file.file));
    cx.flush_notes();
    let id = recorded?;
    Ok(SaveResult {
        id: id.map(|id| id.to_string()),
    })
}

/// Writes the commit `commit` names as the working file of a new branch beside
/// the set's file. No save of the new file is recorded.
pub fn checkout(
    cx: &mut Context,
    cwd: &Path,
    commit: &str,
    branch: &str,
) -> Result<CheckoutResult, CliError> {
    let repo = open(cx, cwd)?;
    let (id, _) = resolve_prefix(&repo, commit, Scope::Commits)?;
    repo.checkout_new_branch(&id, branch)?;
    let set_id = repo.read_commit(&id)?.set_id;
    let file = repo
        .branch_files(&set_id)?
        .remove(branch)
        .ok_or_else(|| CliError(format!("Branch `{branch}` has no file.")))?;
    Ok(CheckoutResult {
        file,
        branch: branch.to_string(),
        set_id,
    })
}

/// How long a working file's set was open, from the spans the dit app kept (`.dit/time`): no app, no spans, and
/// every figure is zero. Nothing is recorded; the app's open span lags by the last minute.
pub fn time(cx: &Context, cwd: &Path, set: Option<&str>) -> Result<TimeResult, CliError> {
    let repo = open(cx, cwd)?;
    let files = working_files(&repo)?;
    let files = match set {
        Some(name) => vec![resolve(&files, name)?],
        None => files,
    };
    let mut sets = Vec::with_capacity(files.len());
    for file in files {
        let commits = repo
            .time_by_commit(&file.set_id, &file.branch)?
            .into_iter()
            .map(|(id, ms)| {
                Ok(TimeCommit {
                    id: id.to_string(),
                    message: repo.read_commit(&id)?.message,
                    ms,
                })
            })
            .collect::<Result<_, CliError>>()?;
        sets.push(TimeRow {
            total_ms: repo.time_in_set(&file.set_id, &file.branch, i64::MIN, i64::MAX)?,
            since_commit_ms: repo.time_since_commit(&file.set_id, &file.branch)?,
            commits,
            set_id: file.set_id,
            file: file.file,
            branch: file.branch,
        });
    }
    Ok(TimeResult { sets })
}

pub(crate) fn open(cx: &Context, cwd: &Path) -> Result<Repo, CliError> {
    Ok(Repo::open(cwd, &registry())?.with_machine(cx.saving_machine()))
}

/// Every working file the repo knows, sorted by file.
pub(crate) fn working_files(repo: &Repo) -> Result<Vec<WorkingFile>, CliError> {
    let mut files = Vec::new();
    for (set_id, file) in repo.sets()? {
        for (branch, file) in repo.branch_files(&set_id)? {
            files.push(WorkingFile {
                set_id: set_id.clone(),
                file,
                branch,
            });
        }
        files.push(WorkingFile {
            set_id,
            file,
            branch: "main".to_string(),
        });
    }
    files.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(files)
}

/// The working file `name` names: its file name with or without the extension.
pub(crate) fn resolve(files: &[WorkingFile], name: &str) -> Result<WorkingFile, CliError> {
    let mut matches = files.iter().filter(|file| {
        let path = Path::new(&file.file);
        path.file_name().is_some_and(|full| full == name)
            || path.file_stem().is_some_and(|stem| stem == name)
    });
    match (matches.next(), matches.next()) {
        (Some(file), None) => Ok(file.clone()),
        (Some(_), Some(_)) => Err(CliError(format!("`{name}` matches more than one file."))),
        (None, _) => Err(CliError(format!("No set named `{name}`."))),
    }
}

/// The working file a command acts on: the one named, else the only one, else
/// the one whose latest save has the greatest `fileUpdatedAt`. With
/// `record_first` the candidates are saved before they are compared.
fn target(
    cx: &mut Context,
    repo: &Repo,
    name: Option<&str>,
    record_first: bool,
) -> Result<WorkingFile, CliError> {
    let files = working_files(repo)?;
    if files.is_empty() {
        return Err(CliError("No sets in this repo.".to_string()));
    }
    let candidates = match name {
        Some(name) => vec![resolve(&files, name)?],
        None => files,
    };
    if record_first {
        for file in &candidates {
            record_working(cx, repo, file)?;
        }
    }
    if candidates.len() == 1 {
        return Ok(candidates.into_iter().next().expect("one candidate"));
    }
    let mut newest: Option<(i64, WorkingFile)> = None;
    for file in candidates {
        if let Some((_, save)) = latest_save(repo, &file)?
            && newest
                .as_ref()
                .is_none_or(|(at, _)| save.file_updated_at >= *at)
        {
            newest = Some((save.file_updated_at, file));
        }
    }
    newest
        .map(|(_, file)| file)
        .ok_or_else(|| CliError("No sets in this repo.".to_string()))
}

/// The working file with the latest modification time on disk; the only one
/// when there is one, whether or not it exists. Missing files are passed over.
fn newest_on_disk(cx: &mut Context, repo: &Repo) -> Result<WorkingFile, CliError> {
    let files = working_files(repo)?;
    if files.len() <= 1 {
        return target(cx, repo, None, false);
    }
    files
        .into_iter()
        .filter_map(|file| {
            let modified = std::fs::metadata(repo.root().join(&file.file))
                .and_then(|meta| meta.modified())
                .ok()?;
            Some((modified, file))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, file)| file)
        .ok_or_else(|| CliError("No set file found on disk.".to_string()))
}

fn latest_save(repo: &Repo, file: &WorkingFile) -> Result<Option<(ObjectId, Save)>, CliError> {
    let Some(id) = repo.log(&file.set_id, &file.branch)?.pop() else {
        return Ok(None);
    };
    let save = repo.read_save(&id)?;
    Ok(Some((id, save)))
}

/// The latest save of the working file, which must have one.
fn latest_of(repo: &Repo, file: &WorkingFile) -> Result<Save, CliError> {
    latest_save(repo, file)?
        .map(|(_, save)| save)
        .ok_or_else(|| CliError(format!("`{}` has no saves yet.", file.file)))
}

/// The ids an id prefix is looked up among.
#[derive(Clone, Copy, PartialEq)]
enum Scope {
    /// Commits and saves.
    Any,
    Commits,
}

/// The shortest id prefix accepted.
const MIN_PREFIX: usize = 4;

/// The save a commit or save id prefix names, looked up across every working
/// file's commit history and save log.
fn resolve_id(repo: &Repo, prefix: &str) -> Result<Save, CliError> {
    Ok(resolve_prefix(repo, prefix, Scope::Any)?.1)
}

/// The id `prefix` (lowercase hex, at least `MIN_PREFIX` characters) starts,
/// with the save it names: a commit's own save, a save itself. A commit and the
/// save it names are two ids, so a prefix both start is ambiguous.
fn resolve_prefix(repo: &Repo, prefix: &str, scope: Scope) -> Result<(ObjectId, Save), CliError> {
    let prefix = prefix.to_ascii_lowercase();
    if prefix.len() < MIN_PREFIX {
        return Err(CliError(format!("Id prefix `{prefix}` is too short.")));
    }
    let mut found: Vec<(ObjectId, ObjectId)> = Vec::new();
    let mut add = |id: ObjectId, save: ObjectId| {
        if id.to_string().starts_with(&prefix) && !found.iter().any(|(seen, _)| *seen == id) {
            found.push((id, save));
        }
    };
    for file in working_files(repo)? {
        for entry in repo.history(&file.set_id, &file.branch)? {
            add(entry.id, entry.commit.save);
        }
        if scope == Scope::Any {
            for id in repo.log(&file.set_id, &file.branch)? {
                add(id, id);
            }
        }
    }
    match (found.pop(), found.is_empty()) {
        (Some((id, save)), true) => Ok((id, repo.read_save(&save)?)),
        (Some(_), false) => Err(CliError(format!("Ambiguous id `{prefix}`."))),
        (None, _) => Err(CliError(match scope {
            Scope::Any => format!("No commit or save `{prefix}`."),
            Scope::Commits => format!("No commit `{prefix}`."),
        })),
    }
}

/// The difference from `from` to `to` and the line that words it. `None` when either save holds its file whole
/// and so has no document to compare.
fn compare(repo: &Repo, from: &Save, to: &Save) -> Result<Option<(DiffSummary, String)>, CliError> {
    match repo.diff(from, to) {
        Ok(diff) => {
            let line = summary_line(&diff, from.meta.as_ref(), to.meta.as_ref());
            Ok(Some((diff, line)))
        }
        Err(RepoError::NoDocument) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The branch head's commit and the save it names.
fn head(repo: &Repo, file: &WorkingFile) -> Result<Option<(Commit, Save)>, CliError> {
    let Some(id) = repo.read_ref(&file.set_id, &file.branch)? else {
        return Ok(None);
    };
    let commit = repo.read_commit(&id)?;
    let save = repo.read_save(&commit.save)?;
    Ok(Some((commit, save)))
}

fn status_row(repo: &Repo, file: WorkingFile, pending: &[Pending]) -> Result<StatusRow, CliError> {
    let saves_since_commit = repo.saves_since_commit(&file.set_id, &file.branch)?;
    let working_changed = repo.working_changed(&file.set_id, &file.branch)?;
    let (pending_saves, pending_commits, pending_samples) = pending
        .iter()
        .find(|p| p.set_id == file.set_id && p.branch == file.branch)
        .map_or((0, 0, 0), |p| (p.saves, p.commits, p.samples));
    Ok(StatusRow {
        set_id: file.set_id,
        file: file.file,
        branch: file.branch,
        saves_since_commit,
        working_changed,
        pending_saves,
        pending_commits,
        pending_samples,
    })
}

fn record_working(cx: &mut Context, repo: &Repo, file: &WorkingFile) -> Result<(), CliError> {
    record(cx, repo, &repo.root().join(&file.file))
}

/// Records a save of the file. A file that is missing or that Live is still
/// writing is a warning on stderr, so the command can go on with the saves
/// already recorded.
fn record(cx: &mut Context, repo: &Repo, path: &Path) -> Result<(), CliError> {
    let name = path.strip_prefix(repo.root()).unwrap_or(path).display();
    if !path.is_file() {
        cx.say(format_args!("warning: {name}: file is missing"));
        return Ok(());
    }
    let recorded = repo.record_save(path);
    cx.flush_notes();
    match recorded {
        Ok(_) => Ok(()),
        Err(RepoError::Daw(error)) => {
            cx.say(format_args!("warning: {name}: {error}"));
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}
