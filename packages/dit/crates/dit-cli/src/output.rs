//! Text and JSON renderings of the command results. Text is plain and git-like.

use serde::Serialize;

use dit_core::format_span;
use dit_core::remote::{Logout, Rebound, SignedIn};
use dit_daemon::renders::driver::UploadEnd;
use dit_daemon::{RenderEvent, RenderState};

use crate::backfill::{Brought, Ending, Found, Listed as Folders};
use crate::commands::{
    CheckoutResult, CommitResult, DiffResult, InitResult, LogResult, SaveResult, StatusResult,
    TimeResult,
};
use crate::config::{PushSamplesResult, SamplesMode};
use crate::push::PushResult;
use crate::renders::{Accepted, Listed, Rejected, STALE_LINE};
use crate::script::ScriptResult;

/// The hex characters of an id shown in text.
const SHORT_ID: usize = 8;

fn short(id: &str) -> &str {
    &id[..SHORT_ID.min(id.len())]
}

fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

pub fn json<T: Serialize>(result: &T) -> String {
    serde_json::to_string(result).expect("a command result serialises")
}

pub fn init(result: &InitResult) -> String {
    let mut lines = vec![format!("dit repo ready in {}", result.root)];
    lines.extend(result.sets.iter().map(|set| match set.branch.as_str() {
        "main" => format!("  {}", set.file),
        branch => format!("  {} ({branch})", set.file),
    }));
    lines.join("\n")
}

pub fn status(result: &StatusResult) -> String {
    if result.sets.is_empty() {
        return "No sets in this repo.".to_string();
    }
    let mut lines: Vec<String> = result
        .sets
        .iter()
        .map(|row| {
            let change = if row.working_changed {
                "changes to commit"
            } else {
                "nothing to commit"
            };
            let line = format!(
                "{} ({}): {} since the last commit, {change}",
                row.file,
                row.branch,
                plural(row.saves_since_commit, "save"),
            );
            let line = if row.pending_saves == 0 && row.pending_commits == 0 {
                line
            } else {
                format!(
                    "{line}, {} and {} to push",
                    plural(row.pending_saves, "save"),
                    plural(row.pending_commits, "commit"),
                )
            };
            if row.pending_samples == 0 {
                line
            } else {
                format!("{line}, samples pending")
            }
        })
        .collect();
    lines.extend(result.samples.map(samples_line));
    lines.join("\n")
}

fn samples_line(mode: SamplesMode) -> String {
    match mode {
        SamplesMode::Pushed => "samples: pushed",
        SamplesMode::Instance => "samples: pushed (instance)",
        SamplesMode::LocalOnly => "samples: local only",
    }
    .to_string()
}

pub fn push_samples(result: &PushSamplesResult) -> String {
    samples_line(result.samples)
}

pub fn log(result: &LogResult) -> String {
    if result.commits.is_empty() {
        return "No commits yet.".to_string();
    }
    let mut lines = Vec::new();
    for commit in &result.commits {
        lines.push(format!("{} {}", short(&commit.id), commit.message));
        for save in &commit.saves {
            let note = if save.view_only { " (view only)" } else { "" };
            lines.push(format!("    save {}{note}", short(&save.id)));
        }
    }
    lines.join("\n")
}

pub fn commit(result: &CommitResult) -> String {
    let mut lines = vec![format!(
        "[{} {}] {}",
        result.branch,
        short(&result.id),
        result.message
    )];
    if let Some(pushed) = &result.pushed {
        lines.extend(bound_line(pushed));
        lines.push(format!("Pushed to {}.", pushed.host));
        if result.samples_pending {
            lines.push("samples pending, run dit push".to_string());
        }
    }
    if let Some(error) = &result.push_error {
        let note = if result.push_error_needs_note {
            " The commit is kept here; run dit push to send it."
        } else {
            ""
        };
        lines.push(format!("{error}{note}"));
    }
    lines.join("\n")
}

fn bound_line(result: &PushResult) -> Option<String> {
    result
        .report
        .bound
        .as_ref()
        .map(|bound| format!("Bound this repo to {} on {}.", bound.project, result.host))
}

pub fn push(result: &PushResult) -> String {
    let mut lines: Vec<String> = bound_line(result).into_iter().collect();
    if result.report.branches.is_empty() && result.refused.is_none() {
        lines.push("Everything is pushed.".to_string());
    }
    for branch in &result.report.branches {
        let file = result
            .files
            .get(&branch.set_id)
            .map_or(branch.set_id.as_str(), String::as_str);
        if branch.saves > 0 || branch.commits > 0 {
            let claimed = if branch.objects_claimed == 0 {
                String::new()
            } else {
                format!(", {} already on the hub", branch.objects_claimed)
            };
            lines.push(format!(
                "{file} ({}): {}, {}, {} uploaded ({} new to the hub){claimed}",
                branch.branch,
                plural(branch.saves, "save"),
                plural(branch.commits, "commit"),
                plural(branch.objects_stored + branch.objects_known, "object"),
                branch.objects_stored,
            ));
        }
        if branch.lineage > 0 && branch.saves == 0 && branch.commits == 0 {
            lines.push(format!(
                "{file} ({}): {} linked to their saves on the hub",
                branch.branch,
                plural(branch.lineage, "commit"),
            ));
        }
        let samples = &branch.samples;
        if samples.commits > 0 {
            let claimed = if samples.objects_claimed == 0 {
                String::new()
            } else {
                format!(", {} already on the hub", samples.objects_claimed)
            };
            lines.push(format!(
                "{file} ({}): samples of {}, {} uploaded ({} new to the hub){claimed}",
                branch.branch,
                plural(samples.commits, "commit"),
                plural(samples.objects_stored + samples.objects_known, "object"),
                samples.objects_stored,
            ));
        }
    }
    lines.join("\n")
}

/// The line a push the hub's storage cap ended fails with, after what the push sent: the hub's words, and that the
/// commits are on the hub.
pub fn push_refusal(message: &str) -> String {
    format!("{message} The commits are on the hub; dit push sends the samples when there is room.")
}

pub fn remote_set(result: &Rebound) -> String {
    if result.from == result.to {
        return format!("This repo already pushes to {}.", result.to);
    }
    format!(
        "This repo pushes to {} now, not {}: {} moved.",
        result.to,
        result.from,
        plural(result.sets, "set")
    )
}

/// The summary line, then one line per non-empty list.
pub fn diff(result: &DiffResult) -> String {
    let diff = &result.diff;
    let mut lines = vec![result.line.clone()];
    for (label, names) in [
        ("Added", &diff.tracks_added),
        ("Removed", &diff.tracks_removed),
        ("Changed", &diff.tracks_changed),
        ("Sections", &diff.sections_changed),
        ("Replaced samples", &diff.samples_replaced),
    ] {
        if !names.is_empty() {
            lines.push(format!("{label}: {}", names.join(", ")));
        }
    }
    lines.extend(diff.scalars.iter().map(|change| {
        let side = |value: &Option<String>| value.clone().unwrap_or_else(|| "none".to_string());
        format!(
            "{}: {} \u{2192} {}",
            change.field,
            side(&change.from),
            side(&change.to)
        )
    }));
    if lines.len() == 1 {
        return "No changes.".to_string();
    }
    lines.join("\n")
}

pub fn save(result: &SaveResult) -> String {
    match &result.id {
        Some(id) => short(id).to_string(),
        None => "No change".to_string(),
    }
}

pub fn checkout(result: &CheckoutResult) -> String {
    result.file.clone()
}

pub fn restore(result: &dit_core::remote::Restored) -> String {
    format!(
        "Restored as branch {}: {}",
        result.branch,
        result.file.display()
    )
}

/// One line for each working file, and under it one for each commit: the set's open time in it.
pub fn time(result: &TimeResult) -> String {
    let mut lines = Vec::new();
    for row in &result.sets {
        let tail = if row.commits.is_empty() {
            "no commits yet".to_string()
        } else {
            format!("{} since the last commit", format_span(row.since_commit_ms))
        };
        lines.push(format!(
            "{} ({}): {} in the set, {tail}",
            row.file,
            row.branch,
            format_span(row.total_ms)
        ));
        lines.extend(row.commits.iter().map(|commit| {
            format!(
                "  {} {}  {}",
                short(&commit.id),
                commit.message,
                format_span(commit.ms)
            )
        }));
    }
    if lines.is_empty() {
        return "No sets in this repo.".to_string();
    }
    lines.join("\n")
}

/// One block per DAW: where the script is, whether it is installed and current, and whether the DAW has it on.
pub fn script(result: &ScriptResult) -> String {
    let mut lines = Vec::new();
    for row in &result.scripts {
        let state = match (row.installed, row.current) {
            (false, _) => "not installed".to_string(),
            (true, true) => format!("installed, version {}", row.version),
            (true, false) => format!(
                "installed, out of date (this dit has version {}; run dit script install)",
                row.version
            ),
        };
        lines.push(format!("{}: {state}", row.name));
        lines.push(format!("  folder: {}", row.folder));
        if let Some(written) = row.written {
            lines.push(if written == 0 {
                "  already up to date".to_string()
            } else {
                format!("  wrote {written} files")
            });
        }
        lines.push(format!(
            "  switched on in {}'s last run: {}",
            row.name,
            match row.enabled {
                Some(true) => "yes",
                Some(false) =>
                    "no: enable it in Settings > Link, Tempo & MIDI > Control Surface (dit)",
                None => "unknown",
            }
        ));
        lines.push("  connected: needs the dit app".to_string());
        if row.written.is_some_and(|written| written > 0) && row.running {
            lines.push(format!(
                "  {} is running: restart it to load the script",
                row.name
            ));
        }
    }
    if lines.is_empty() {
        return "No DAW has a script.".to_string();
    }
    lines.join("\n")
}

pub fn signed_in(result: &SignedIn) -> String {
    format!(
        "Signed in to {} as {} ({}) on {}",
        result.instance.host(),
        result.user.name,
        result.user.email,
        result.machine
    )
}

pub fn logout(result: &Logout) -> String {
    match &result.instance {
        Some(instance) => format!("Signed out of {}", instance.host()),
        None => "Not signed in.".to_string(),
    }
}

const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];

/// The unit a size reads in, as an index into `UNITS`, and the bytes in one of it: 1024-based, the largest being GB.
fn scale_of(bytes: u64) -> (usize, f64) {
    let mut unit = 0;
    let mut scale = 1.0;
    while bytes as f64 / scale >= 1024.0 && unit < UNITS.len() - 1 {
        scale *= 1024.0;
        unit += 1;
    }
    (unit, scale)
}

/// A size in bytes as a person reads it: `812 B`, `4.2 MB`.
pub(crate) fn size(bytes: u64) -> String {
    let (unit, scale) = scale_of(bytes);
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{:.1} {}", bytes as f64 / scale, UNITS[unit])
    }
}

/// How far an upload is, both numbers in the unit of the whole: `3.1 of 8.4 GB`.
pub(crate) fn upload_progress(sent: u64, of: u64) -> String {
    let (unit, scale) = scale_of(of);
    if unit == 0 {
        format!("{sent} of {of} B")
    } else {
        format!(
            "{:.1} of {:.1} {}",
            sent as f64 / scale,
            of as f64 / scale,
            UNITS[unit]
        )
    }
}

/// A whole number with a comma between each three digits: `3,412`.
pub(crate) fn thousands(count: u64) -> String {
    let digits = count.to_string();
    let mut text = String::with_capacity(digits.len() + digits.len() / 3);
    for (at, digit) in digits.chars().enumerate() {
        if at > 0 && (digits.len() - at).is_multiple_of(3) {
            text.push(',');
        }
        text.push(digit);
    }
    text
}

/// A count and its noun, the noun plural unless the count is one: `1 save`, `3,412 saves`.
pub(crate) fn counted(count: u64, noun: &str) -> String {
    format!(
        "{} {noun}{}",
        thousands(count),
        if count == 1 { "" } else { "s" }
    )
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// The year, month (1 to 12) and day of the UTC date `ms` milliseconds after the epoch falls on.
fn civil(ms: i64) -> (i64, usize, i64) {
    let z = ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month as usize, day)
}

/// A date as a person reads it, in UTC: `12 Mar 2024`.
pub(crate) fn date(ms: i64) -> String {
    let (year, month, day) = civil(ms);
    format!("{day} {} {year}", &MONTHS[month - 1][..3])
}

/// The month and year a time falls in, in UTC: `March 2019`.
pub(crate) fn month_year(ms: i64) -> String {
    let (year, month, _) = civil(ms);
    format!("{} {year}", MONTHS[month - 1])
}

fn state_name(state: RenderState) -> &'static str {
    match state {
        RenderState::Waiting => "waiting",
        RenderState::Proposed => "proposed",
        RenderState::Uploading => "uploading",
        RenderState::QueuedOffline => "queued-offline",
        RenderState::Added => "added",
        RenderState::OverLimit => "over-limit",
        RenderState::Rejected => "rejected",
    }
}

/// One line a render: `<id> <state> <name> (<N files>, <size>)`; a list from the ledger ends with a line saying the
/// app is not running.
pub fn renders(result: &Listed) -> String {
    let mut lines: Vec<String> = result
        .cards
        .iter()
        .map(|card| {
            format!(
                "{} {} {} ({}, {})",
                card.id,
                state_name(card.state),
                card.name,
                plural(card.files.len(), "file"),
                size(card.files.iter().map(|file| file.size).sum()),
            )
        })
        .collect();
    if lines.is_empty() {
        lines.push("No renders.".to_string());
    }
    if result.stale {
        lines.push(STALE_LINE.to_string());
    }
    lines.join("\n")
}

fn session_of(card: &RenderEvent) -> String {
    card.session_id
        .map_or_else(String::new, |session| format!(" to session {session}"))
}

pub fn render_accepted(result: &Accepted) -> String {
    let card = &result.card;
    match &result.ended {
        None => format!(
            "Adding {}{}: the dit app is uploading it.",
            card.name,
            session_of(card)
        ),
        Some(UploadEnd::Added) => format!("Added {}{}.", card.name, session_of(card)),
        Some(UploadEnd::NoTrack) => {
            format!("Uploaded {}, but its session has no track yet.", card.name)
        }
        Some(UploadEnd::Offline { .. } | UploadEnd::SignedOut { .. }) => {
            format!("Queued {}.", card.name)
        }
        Some(UploadEnd::Refused { .. } | UploadEnd::Failed { .. }) => String::new(),
    }
}

/// The line an accept that did not add the render fails with.
pub fn render_refusal(result: &Accepted) -> Option<String> {
    let card = &result.card;
    match result.ended.as_ref()? {
        UploadEnd::Added => None,
        UploadEnd::NoTrack => Some(format!(
            "This session has no track yet. Give it one, then run dit renders accept {} again.",
            card.id
        )),
        UploadEnd::Offline { message } => Some(format!(
            "{message} {} stays queued; the dit app retries it when it runs.",
            card.name
        )),
        UploadEnd::SignedOut { host } => Some(format!(
            "Signed out of {host}. Run dit login. {} stays queued.",
            card.name
        )),
        UploadEnd::Refused { message } | UploadEnd::Failed { message } => Some(message.clone()),
    }
}

pub fn render_rejected(result: &Rejected) -> String {
    let card = &result.card;
    let mut line = format!("Rejected {} as not a bounce.", card.name);
    if result.never_here
        && let Some(folder) = card.files.first().and_then(|file| file.path.parent())
    {
        line.push_str(&format!(
            " Nothing will be proposed from {} again.",
            folder.display()
        ));
    }
    line
}

/// `path` with the home folder written as `~`.
fn tilde(path: &str, home: Option<&std::path::Path>) -> String {
    match home.and_then(|home| std::path::Path::new(path).strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~/{}", rest.display()),
        None => path.to_string(),
    }
}

fn found_line(found: &Found, home: Option<&std::path::Path>) -> String {
    let mut line = format!(
        "{}  {}  {}",
        tilde(&found.path, home),
        counted(found.sets as u64, "set"),
        size(found.bytes)
    );
    if let Some(newest) = found.newest {
        line.push_str(&format!("  last saved {}", date(newest)));
    }
    if found.already {
        line.push_str(" · already in dit");
    }
    if let Some(service) = &found.synced_by {
        line.push_str(&format!(" · synced by {service}"));
    }
    line
}

/// One line a project folder found, newest save first; a search that found none says so.
pub fn backfill_list(result: &Folders) -> String {
    if result.folders.is_empty() {
        return "No Live projects found.".to_string();
    }
    let home = result.home.as_deref();
    result
        .folders
        .iter()
        .map(|found| found_line(found, home))
        .collect::<Vec<_>>()
        .join("\n")
}

/// What a backfill brought in, folder by folder, then how it ended and what the history now holds.
pub fn backfill_result(result: &Brought) -> String {
    let mut lines = Vec::new();
    for folder in &result.folders {
        let name = std::path::Path::new(&folder.path)
            .file_name()
            .map_or_else(|| folder.path.clone(), |n| n.to_string_lossy().into_owned());
        match folder.state {
            Ending::Done => lines.push(format!(
                "brought in {name}: {}, {}, {}",
                counted(u64::from(folder.sets.unwrap_or(0)), "set"),
                counted(folder.saves.unwrap_or(0), "save"),
                size(folder.bytes.unwrap_or(0))
            )),
            Ending::Failed => lines.push(format!(
                "failed {name}: {}",
                folder
                    .error
                    .as_deref()
                    .unwrap_or("it could not be brought in")
            )),
            Ending::Paused | Ending::Waiting => {}
        }
    }
    if result.paused {
        lines.push("paused; run the same command to carry on".to_string());
    }
    let summary = &result.summary;
    if let Some(first) = summary.first_save
        && summary.projects > 0
    {
        lines.push(format!(
            "history goes back to {}: {} across {} in {}",
            month_year(first),
            counted(summary.saves, "save"),
            counted(u64::from(summary.sets), "set"),
            counted(u64::from(summary.projects), "project")
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use dit_core::remote::{Bound, BranchPush, PushReport, SamplesPush};

    use super::*;
    use crate::commands::StatusRow;

    fn pushed(objects_stored: usize, objects_known: usize, bound: Option<Bound>) -> PushResult {
        PushResult {
            report: PushReport {
                bound,
                branches: vec![BranchPush {
                    set_id: "set-1".to_string(),
                    branch: "main".to_string(),
                    saves: 2,
                    commits: 1,
                    objects_stored,
                    objects_known,
                    objects_claimed: 0,
                    segments: 0,
                    lineage: 0,
                    samples: SamplesPush::default(),
                }],
            },
            refused: None,
            host: "hub.example.com".to_string(),
            files: BTreeMap::from([("set-1".to_string(), "Song.als".to_string())]),
        }
    }

    fn with_samples(samples: SamplesPush) -> PushResult {
        let mut result = pushed(0, 0, None);
        result.report.branches[0].saves = 0;
        result.report.branches[0].commits = 0;
        result.report.branches[0].samples = samples;
        result
    }

    #[test]
    fn push_text_of_samples_alone_says_only_the_sample_line() {
        let samples = SamplesPush {
            commits: 2,
            objects_stored: 4,
            objects_known: 1,
            objects_claimed: 3,
        };
        assert_eq!(
            push(&with_samples(samples)),
            "Song.als (main): samples of 2 commits, 5 objects uploaded (4 new to the hub), 3 already on the hub"
        );
    }

    #[test]
    fn push_text_of_a_push_the_hub_refused_has_no_everything_is_pushed_line() {
        let mut result = pushed(0, 0, None);
        result.report.branches.clear();
        result.refused = Some("This instance is out of storage.".to_string());
        assert_eq!(push(&result), "");
    }

    #[test]
    fn push_refusal_says_the_commits_are_on_the_hub() {
        assert_eq!(
            push_refusal("This instance is out of storage."),
            "This instance is out of storage. The commits are on the hub; dit push sends the samples when there is room."
        );
    }

    #[test]
    fn commit_text_says_samples_are_pending_only_after_a_push_that_succeeded() {
        let mut result = CommitResult {
            id: "abcdef0123".to_string(),
            message: "idea".to_string(),
            diff: None,
            branch: "main".to_string(),
            pushed: Some(pushed(1, 0, None)),
            push_error: None,
            push_error_needs_note: false,
            samples_pending: true,
        };
        assert!(
            commit(&result).ends_with("Pushed to hub.example.com.\nsamples pending, run dit push")
        );
        result.samples_pending = false;
        assert!(!commit(&result).contains("samples"));
    }

    #[test]
    fn status_text_marks_a_branch_whose_samples_are_pending() {
        let result = StatusResult {
            sets: vec![StatusRow {
                set_id: "set-1".to_string(),
                file: "Song.als".to_string(),
                branch: "main".to_string(),
                saves_since_commit: 0,
                working_changed: false,
                pending_saves: 0,
                pending_commits: 0,
                pending_samples: 2,
            }],
            samples: Some(SamplesMode::Pushed),
        };
        assert_eq!(
            status(&result),
            "Song.als (main): 0 saves since the last commit, nothing to commit, samples pending\nsamples: pushed"
        );
    }

    #[test]
    fn push_text_counts_every_uploaded_object_and_those_new_to_the_hub() {
        assert_eq!(
            push(&pushed(3, 2, None)),
            "Song.als (main): 2 saves, 1 commit, 5 objects uploaded (3 new to the hub)"
        );
    }

    #[test]
    fn push_text_of_objects_the_hub_already_held_says_none_are_new() {
        assert_eq!(
            push(&pushed(0, 1, None)),
            "Song.als (main): 2 saves, 1 commit, 1 object uploaded (0 new to the hub)"
        );
    }

    #[test]
    fn push_text_starts_with_the_binding_a_first_push_made() {
        let bound = Bound {
            project: "Album".to_string(),
            repo_id: 3,
        };

        let text = push(&pushed(1, 0, Some(bound)));

        assert_eq!(
            text.lines().next(),
            Some("Bound this repo to Album on hub.example.com.")
        );
    }

    #[test]
    fn push_json_leaves_out_bound_when_the_push_did_not_bind() {
        let unbound: serde_json::Value = serde_json::from_str(&json(&pushed(1, 0, None))).unwrap();
        let bound = Bound {
            project: "Album".to_string(),
            repo_id: 3,
        };
        let first: serde_json::Value =
            serde_json::from_str(&json(&pushed(1, 0, Some(bound)))).unwrap();

        assert!(unbound.as_object().unwrap().get("bound").is_none());
        assert_eq!(first["bound"]["project"], "Album");
        assert_eq!(unbound["branches"][0]["objectsKnown"], 0);
    }

    fn rebound(to: &str, sets: usize) -> Rebound {
        Rebound {
            from: "http://hub.example.com".to_string(),
            to: to.to_string(),
            sets,
        }
    }

    #[test]
    fn remote_set_text_names_both_origins_and_the_sets_moved() {
        assert_eq!(
            remote_set(&rebound("https://hub.example.com", 2)),
            "This repo pushes to https://hub.example.com now, not http://hub.example.com: 2 sets moved."
        );
    }

    #[test]
    fn remote_set_text_of_the_origin_already_bound_says_so() {
        assert_eq!(
            remote_set(&rebound("http://hub.example.com", 0)),
            "This repo already pushes to http://hub.example.com."
        );
    }

    #[test]
    fn sizes_are_1024_based_with_one_decimal_and_stop_at_gb() {
        assert_eq!(size(812), "812 B");
        assert_eq!(size(1024), "1.0 KB");
        assert_eq!(size(4_404_019), "4.2 MB");
        assert_eq!(size(2_469_606_195), "2.3 GB");
        assert_eq!(size(3 * 1024 * 1024 * 1024 * 1024), "3072.0 GB");
    }

    #[test]
    fn an_upload_reads_both_numbers_in_the_unit_of_the_whole() {
        assert_eq!(
            upload_progress(3_328_599_654, 9_019_431_321),
            "3.1 of 8.4 GB"
        );
        assert_eq!(upload_progress(512, 2048), "0.5 of 2.0 KB");
        assert_eq!(upload_progress(0, 900), "0 of 900 B");
    }

    #[test]
    fn counts_have_thousands_separators_and_a_singular() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1_000), "1,000");
        assert_eq!(thousands(3_412), "3,412");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(counted(1, "save"), "1 save");
        assert_eq!(counted(0, "set"), "0 sets");
        assert_eq!(counted(3_412, "save"), "3,412 saves");
    }

    #[test]
    fn dates_are_day_month_year_in_utc() {
        assert_eq!(date(0), "1 Jan 1970");
        assert_eq!(date(1_710_000_000_000), "9 Mar 2024");
        assert_eq!(date(1_709_164_800_000), "29 Feb 2024");
        assert_eq!(date(1_709_251_199_999), "29 Feb 2024");
        assert_eq!(date(1_709_251_200_000), "1 Mar 2024");
        assert_eq!(date(-86_400_000), "31 Dec 1969");
        assert_eq!(date(951_782_400_000), "29 Feb 2000");
    }

    #[test]
    fn the_summary_names_the_month_and_year() {
        assert_eq!(month_year(1_551_398_400_000), "March 2019");
        assert_eq!(month_year(0), "January 1970");
        assert_eq!(month_year(1_735_689_599_000), "December 2024");
    }

    fn found(path: &str) -> Found {
        Found {
            path: path.to_string(),
            sets: 8,
            bytes: 2_469_606_195,
            newest: Some(1_710_000_000_000),
            already: false,
            synced_by: None,
        }
    }

    #[test]
    fn a_found_folder_is_a_line_with_the_home_folder_as_a_tilde() {
        let list = Folders {
            folders: vec![found("/Users/me/Music/Ableton/science Project")],
            home: Some("/Users/me".into()),
        };

        assert_eq!(
            backfill_list(&list),
            "~/Music/Ableton/science Project  8 sets  2.3 GB  last saved 9 Mar 2024"
        );
    }

    #[test]
    fn a_found_folder_says_when_it_is_in_dit_or_synced_and_leaves_out_a_save_time_it_has_not() {
        let mut folder = found("/Volumes/Work/a Project");
        folder.sets = 1;
        folder.newest = None;
        folder.already = true;
        folder.synced_by = Some("iCloud Drive".to_string());
        let list = Folders {
            folders: vec![folder],
            home: Some("/Users/me".into()),
        };

        assert_eq!(
            backfill_list(&list),
            "/Volumes/Work/a Project  1 set  2.3 GB · already in dit · synced by iCloud Drive"
        );
    }

    #[test]
    fn a_search_that_finds_nothing_says_so() {
        let list = Folders {
            folders: Vec::new(),
            home: None,
        };

        assert_eq!(backfill_list(&list), "No Live projects found.");
    }

    #[test]
    fn a_listed_folder_is_json_with_camel_case_names() {
        let list = Folders {
            folders: vec![found("/a Project")],
            home: None,
        };

        let value: serde_json::Value = serde_json::from_str(&json(&list)).unwrap();

        assert_eq!(
            value,
            serde_json::json!([{
                "path": "/a Project",
                "sets": 8,
                "bytes": 2_469_606_195u64,
                "newest": 1_710_000_000_000i64,
                "already": false,
                "syncedBy": null,
            }])
        );
    }
}
