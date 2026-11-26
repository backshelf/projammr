//! Time in a set: the spans a set was open on this machine, kept beside the save log and summed per commit.
//!
//! `.dit/time/<set id>/<branch>` holds one JSON object a line, `{"start","end","source"}` in milliseconds since the
//! epoch, sorted by `start`. A span's `start` names it: writing a span whose `start` is already there replaces that
//! line, so the one still open can be rewritten as it grows. The file is this machine's alone, so a span carries no
//! machine name; a push stamps its own. Every write is the whole file through a temp file and a rename, under the
//! repo's writer lock, so a crash leaves the old file or the new one.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::layout::DIT_DIR;
use super::refs::{atomic_write, check_branch_name, check_set_id, read_optional};
use super::save::json_error;
use super::{Repo, RepoError};
use crate::store::ObjectId;

const TIME_DIR: &str = "time";

/// What told dit a set was open, best first: the open-set [`Signal`](crate::openset::Signal) a span was made from.
pub use crate::openset::Signal as Source;

/// A span of time a set was open, in milliseconds since the epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub start: i64,
    /// Not before `start`; a span still open ends at the last thing seen of it.
    pub end: i64,
    pub source: Source,
}

impl Segment {
    pub fn len_ms(&self) -> i64 {
        self.end - self.start
    }
}

/// How long `ms` reads: `2h 14m`, `41m`, `2h`, or `<1m` under a minute. Minutes are floored.
pub fn format_span(ms: i64) -> String {
    let minutes = ms.max(0) / 60_000;
    match (minutes / 60, minutes % 60) {
        (0, 0) => "<1m".to_string(),
        (0, minutes) => format!("{minutes}m"),
        (hours, 0) => format!("{hours}h"),
        (hours, minutes) => format!("{hours}h {minutes}m"),
    }
}

/// The length of the union of `segments` (sorted by `start`) inside `[from, to]`. A span counted twice because two
/// overlap is counted once.
fn covered_ms(segments: &[Segment], from: i64, to: i64) -> i64 {
    let mut total = 0;
    let mut covered = from;
    for segment in segments {
        let (low, high) = (segment.start.max(covered), segment.end.min(to));
        if high > low {
            total += high - low;
        }
        covered = covered.max(segment.end.min(to));
    }
    total
}

impl Repo {
    fn time_path(&self, set_id: &str, branch: &str) -> Result<PathBuf, RepoError> {
        check_set_id(set_id)?;
        check_branch_name(branch)?;
        Ok(self
            .root
            .join(DIT_DIR)
            .join(TIME_DIR)
            .join(set_id)
            .join(branch))
    }

    /// The spans a branch's set was open, sorted by start. A last line cut short (a write something else did not
    /// finish) is dropped and the lines before it stand; any other line that does not read is an error.
    pub fn segments(&self, set_id: &str, branch: &str) -> Result<Vec<Segment>, RepoError> {
        let Some(text) = read_optional(&self.time_path(set_id, branch)?)? else {
            return Ok(Vec::new());
        };
        let lines: Vec<&str> = text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect();
        let mut segments = Vec::with_capacity(lines.len());
        for (at, line) in lines.iter().enumerate() {
            match serde_json::from_str::<Segment>(line) {
                Ok(segment) => segments.push(segment),
                Err(_) if at + 1 == lines.len() && !text.ends_with('\n') => {}
                Err(error) => return Err(json_error(error).into()),
            }
        }
        segments.sort_by_key(|segment| segment.start);
        Ok(segments)
    }

    /// Records `segment`, replacing the one with the same `start`. A span cannot end before it starts.
    pub fn upsert_segment(
        &self,
        set_id: &str,
        branch: &str,
        segment: &Segment,
    ) -> Result<(), RepoError> {
        if segment.end < segment.start {
            return Err(RepoError::BadSegment {
                start: segment.start,
                end: segment.end,
            });
        }
        let _lock = self.lock()?;
        let mut segments = self.segments(set_id, branch)?;
        match segments.iter_mut().find(|held| held.start == segment.start) {
            Some(held) => *held = *segment,
            None => {
                segments.push(*segment);
                segments.sort_by_key(|segment| segment.start);
            }
        }
        let mut text = String::new();
        for segment in &segments {
            text.push_str(&serde_json::to_string(segment).map_err(json_error)?);
            text.push('\n');
        }
        atomic_write(&self.time_path(set_id, branch)?, text.as_bytes())
    }

    /// Milliseconds a branch's set was open between `from` and `to`: its spans clipped to the window, overlaps
    /// counted once.
    pub fn time_in_set(
        &self,
        set_id: &str,
        branch: &str,
        from: i64,
        to: i64,
    ) -> Result<i64, RepoError> {
        Ok(covered_ms(&self.segments(set_id, branch)?, from, to))
    }

    /// Milliseconds open since the branch's head commit: after the time of the save the head names, so the saves
    /// and the time since a commit read the same window. With no head, all of it.
    pub fn time_since_commit(&self, set_id: &str, branch: &str) -> Result<i64, RepoError> {
        let from = match self.read_ref(set_id, branch)? {
            Some(head) => {
                self.read_save(&self.read_commit(&head)?.save)?
                    .file_updated_at
            }
            None => i64::MIN,
        };
        self.time_in_set(set_id, branch, from, i64::MAX)
    }

    /// Milliseconds open in each commit reachable from the branch head, newest first: the spans clipped to the
    /// window after the previous commit's save, up to and including this commit's save: the window the hub
    /// sums a commit's time over. A commit that came from another branch's lineage counts that branch's spans.
    pub fn time_by_commit(
        &self,
        set_id: &str,
        branch: &str,
    ) -> Result<Vec<(ObjectId, i64)>, RepoError> {
        let entries = self.history(set_id, branch)?;
        let saved_at =
            |entry: &super::HistoryEntry| entry.saves.last().map(|(_, save)| save.file_updated_at);
        let mut spans: HashMap<(String, String), Vec<Segment>> = HashMap::new();
        let mut times = Vec::with_capacity(entries.len());
        for (at, entry) in entries.iter().enumerate() {
            let key = (entry.commit.set_id.clone(), entry.commit.branch.clone());
            if !spans.contains_key(&key) {
                spans.insert(key.clone(), self.segments(&key.0, &key.1)?);
            }
            let to = saved_at(entry).unwrap_or(i64::MAX);
            let from = entries.get(at + 1).and_then(saved_at).unwrap_or(i64::MIN);
            times.push((entry.id, covered_ms(&spans[&key], from, to)));
        }
        Ok(times)
    }
}
