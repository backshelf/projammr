//! What changed between two saves of a set, read from their trees and parsed
//! metadata alone: no leaf bytes are read and no XML is decoded.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::meta::SetMeta;
use crate::store::{PartEntry, TreeObject, encode_part};
use crate::tree::PartKind;

/// The most clauses `summary_clauses` names before folding the rest into `and N more`.
const SUMMARY_ITEMS: usize = 5;

/// One top-level value of the set that differs between two saves. A side that
/// lacks the value is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarChange {
    pub field: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// The difference between saves `a` and `b`, as display names.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    /// Tracks in `b` only, named from `b`.
    pub tracks_added: Vec<String>,
    /// Tracks in `a` only, named from `a`.
    pub tracks_removed: Vec<String>,
    /// Tracks in both whose part digest differs, named from `b`.
    pub tracks_changed: Vec<String>,
    /// The tag of each Section part whose digest differs or that is on one side only.
    pub sections_changed: Vec<String>,
    /// Empty unless both saves have parsed metadata.
    pub scalars: Vec<ScalarChange>,
    /// The file name of each tracked sample under `Samples/` whose bytes differ between the saves, though the
    /// set may not: filled by `Repo::diff`, which has the saves' sample objects; empty from `diff_trees`.
    #[serde(default)]
    pub samples_replaced: Vec<String>,
}

/// How a part is paired across two trees: Tracks by tag and id, Sections by
/// tag. `nth` counts the earlier parts of the same tag and id on that side, so
/// repeats (and Tracks without an id) pair by position.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PartKey {
    track: bool,
    tag: Option<String>,
    id: Option<String>,
    nth: usize,
}

/// A paired part: its key, its digest and the part itself, in tree order.
struct Keyed<'a> {
    key: PartKey,
    digest: [u8; 32],
    part: &'a PartEntry,
}

fn keyed(tree: &TreeObject) -> Vec<Keyed<'_>> {
    let mut seen: HashMap<(bool, Option<&str>, Option<&str>), usize> = HashMap::new();
    let mut parts = Vec::new();
    for part in &tree.parts {
        let track = match part.kind {
            PartKind::Gap => continue,
            PartKind::Track => true,
            PartKind::Section => false,
        };
        let id = if track { part.id.as_deref() } else { None };
        let count = seen.entry((track, part.tag.as_deref(), id)).or_default();
        let key = PartKey {
            track,
            tag: part.tag.clone(),
            id: id.map(str::to_owned),
            nth: *count,
        };
        *count += 1;
        let mut encoded = Vec::new();
        encode_part(part, &mut encoded);
        parts.push(Keyed {
            key,
            digest: Sha256::digest(&encoded).into(),
            part,
        });
    }
    parts
}

/// A track's display name: its entry in `meta`'s structure by the part id, else
/// `<tag> <id>`, or the tag alone with no id.
fn track_name(part: &PartEntry, meta: Option<&SetMeta>) -> String {
    let tag = part.tag.as_deref().unwrap_or("track");
    let Some(id) = part.id.as_deref() else {
        return tag.to_owned();
    };
    let named = id.parse::<i64>().ok().and_then(|id| {
        meta?
            .structure
            .as_ref()?
            .tracks
            .iter()
            .find(|track| track.id == Some(id))
    });
    match named {
        Some(track) => track.name.clone(),
        None => format!("{tag} {id}"),
    }
}

fn section_name(part: &PartEntry) -> String {
    part.tag.clone().unwrap_or_else(|| "section".to_owned())
}

fn key_of(meta: &SetMeta) -> Option<String> {
    let parts: Vec<&str> = [meta.root_note.as_deref(), meta.scale.as_deref()]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

fn scalars(a: &SetMeta, b: &SetMeta) -> Vec<ScalarChange> {
    Scalar::ALL
        .into_iter()
        .filter_map(|scalar| {
            let (from, to) = (scalar.read(a), scalar.read(b));
            (!scalar.same(&from, &to)).then(|| ScalarChange {
                field: scalar.field().to_owned(),
                from,
                to,
            })
        })
        .collect()
}

/// Compares two trees and their metadata. Part digests hash the encoded part,
/// whose leaves are masked, so a part whose only change was volatile values
/// digests the same. The scalars are compared only when both saves have meta.
pub fn diff_trees(
    a: &TreeObject,
    a_meta: Option<&SetMeta>,
    b: &TreeObject,
    b_meta: Option<&SetMeta>,
) -> DiffSummary {
    let a_parts = keyed(a);
    let b_parts = keyed(b);
    let a_digests: HashMap<&PartKey, &[u8; 32]> =
        a_parts.iter().map(|p| (&p.key, &p.digest)).collect();
    let b_digests: HashMap<&PartKey, &[u8; 32]> =
        b_parts.iter().map(|p| (&p.key, &p.digest)).collect();

    let mut summary = DiffSummary::default();
    for entry in &b_parts {
        let before = a_digests.get(&entry.key);
        let differs = before != Some(&&entry.digest);
        if entry.key.track {
            match before {
                None => summary.tracks_added.push(track_name(entry.part, b_meta)),
                Some(_) if differs => summary.tracks_changed.push(track_name(entry.part, b_meta)),
                Some(_) => {}
            }
        } else if differs {
            summary.sections_changed.push(section_name(entry.part));
        }
    }
    for entry in &a_parts {
        if b_digests.contains_key(&entry.key) {
            continue;
        }
        if entry.key.track {
            summary.tracks_removed.push(track_name(entry.part, a_meta));
        } else {
            summary.sections_changed.push(section_name(entry.part));
        }
    }
    if let (Some(a_meta), Some(b_meta)) = (a_meta, b_meta) {
        summary.scalars = scalars(a_meta, b_meta);
    }
    summary
}

/// `+3 tracks`, `−1 track`: a signed count and its noun, the way the web's save chips word one.
fn signed(count: i64, noun: &str) -> String {
    let (sign, count) = if count < 0 {
        ('\u{2212}', -count)
    } else {
        ('+', count)
    };
    format!("{sign}{count} {noun}{}", if count == 1 { "" } else { "s" })
}

/// The "no value" the web's chips write on the side of a transition that has none.
const ABSENT: &str = "\u{2014}";

/// One part of a suggested message. `kind` says what the text is about, so a panel can group or switch off a
/// kind without reading the words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clause {
    pub kind: ClauseKind,
    pub text: String,
}

impl Clause {
    fn new(kind: ClauseKind, text: impl Into<String>) -> Self {
        Clause {
            kind,
            text: text.into(),
        }
    }
}

/// What a [`Clause`] is about. The first ten read as the web's save chips do (`DiffChipKind` in
/// `packages/session-diff`), by the same names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClauseKind {
    /// `+2 tracks`, `−1 track`.
    Tracks,
    /// `Old → New`.
    Rename,
    /// `+EQ Eight on Bass`, `−Reverb on Vox`, or `N device changes` for the ones past the first three.
    Devices,
    Tempo,
    TimeSignature,
    Key,
    /// `+3 audio clips`.
    Clips,
    /// `+2 scenes`.
    Scenes,
    /// `+1 sample`: sample files the set references, by path.
    Samples,
    /// `12.4 → 12.5`.
    DawVersion,
    /// `~Bass`: a track whose content changed in a way no other clause says.
    TrackEdit,
    /// `~Locators`: a part of the set that is not a track.
    Section,
    /// `Replaced sample kick.wav`: the file under `Samples/` changed and the set did not.
    SampleBytes,
    /// `and 3 more`: what the cap left out.
    More,
    /// `Initial commit`: the first commit of a branch, which has no earlier save to compare with.
    Initial,
}

/// The words of the first commit of a branch.
pub const INITIAL_COMMIT: &str = "Initial commit";

/// The suggested message of a branch's first commit, as one clause: with no head there is no change to word, and the
/// panel and `dit commit` both suggest this.
pub fn initial_clauses() -> Vec<Clause> {
    vec![Clause::new(ClauseKind::Initial, INITIAL_COMMIT)]
}

/// A value a set carries once, that a diff reports as `from → to`: the one table of which meta field it is, what
/// `DiffSummary::scalars` calls it and how a clause words it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scalar {
    Tempo,
    TimeSignature,
    Key,
    Scenes,
    DawVersion,
}

impl Scalar {
    /// In the order a diff lists them.
    const ALL: [Scalar; 5] = [
        Scalar::Tempo,
        Scalar::TimeSignature,
        Scalar::Key,
        Scalar::Scenes,
        Scalar::DawVersion,
    ];

    /// The name `ScalarChange::field` carries.
    fn field(self) -> &'static str {
        match self {
            Scalar::Tempo => "tempo",
            Scalar::TimeSignature => "time signature",
            Scalar::Key => "key",
            Scalar::Scenes => "scenes",
            Scalar::DawVersion => "Live",
        }
    }

    fn named(field: &str) -> Option<Scalar> {
        Scalar::ALL
            .into_iter()
            .find(|scalar| scalar.field() == field)
    }

    fn read(self, meta: &SetMeta) -> Option<String> {
        match self {
            Scalar::Tempo => meta.tempo.clone(),
            Scalar::TimeSignature => meta.time_signature.clone(),
            Scalar::Key => key_of(meta),
            Scalar::Scenes => meta.scenes_count.map(|count| count.to_string()),
            Scalar::DawVersion => meta.daw_version.clone(),
        }
    }

    /// Whether two readings are the same value. A tempo is a number, so `126` and `126.0` are the same tempo.
    fn same(self, a: &Option<String>, b: &Option<String>) -> bool {
        if self == Scalar::Tempo
            && let (Some(a), Some(b)) = (a, b)
            && let (Ok(a), Ok(b)) = (a.parse::<f64>(), b.parse::<f64>())
        {
            return a == b;
        }
        a == b
    }

    /// How the clause writes a value: a tempo as the number it is (`124`, not `124.0`).
    fn write(self, value: &str) -> String {
        match self {
            Scalar::Tempo => value
                .parse::<f64>()
                .ok()
                .filter(|tempo| tempo.is_finite())
                .map_or_else(|| value.to_owned(), |tempo| tempo.to_string()),
            _ => value.to_owned(),
        }
    }

    /// The clause for a change to `to`, or none when there is nothing to say: a value that went away is not
    /// worded (as the web's chips leave it), and scenes are a count that needs both sides.
    fn clause(self, from: Option<&str>, to: &str) -> Option<Clause> {
        let (was, now) = (
            from.map_or_else(|| ABSENT.to_owned(), |from| self.write(from)),
            self.write(to),
        );
        let transition = format!("{was} \u{2192} {now}");
        Some(match self {
            Scalar::Tempo => Clause::new(ClauseKind::Tempo, format!("tempo {transition}")),
            Scalar::TimeSignature => {
                Clause::new(ClauseKind::TimeSignature, format!("time sig {transition}"))
            }
            Scalar::Key => Clause::new(ClauseKind::Key, format!("key {transition}")),
            Scalar::Scenes => {
                let (from, to) = (from?.parse::<i64>().ok()?, to.parse::<i64>().ok()?);
                Clause::new(ClauseKind::Scenes, signed(to - from, "scene"))
            }
            Scalar::DawVersion => Clause::new(ClauseKind::DawVersion, transition),
        })
    }
}

/// The most device changes `summary_clauses` spells out one by one before summing the rest.
const DEVICE_CLAUSES: usize = 3;

/// What the metas say about tracks the digests do not: which were renamed and which gained or lost devices.
#[derive(Default)]
struct TrackMoves {
    renames: Vec<Clause>,
    devices: Vec<Clause>,
    /// How many tracks of each name in `after` a rename or device clause already speaks for.
    explained: HashMap<String, usize>,
}

/// Counts occurrences of each device name on a track chain.
fn device_counts(devices: &[String]) -> HashMap<&str, usize> {
    let mut counts = HashMap::with_capacity(devices.len());
    for device in devices {
        *counts.entry(device.as_str()).or_insert(0) += 1;
    }
    counts
}

/// Pairs each track of `after` with its track in `before`: by the DAW's track id when both have one, else by
/// name occurrence order so duplicate track names pair 1-to-1 rather than colliding. A pair with another name
/// is a rename; a pair with other devices names the devices it gained and lost using multiset counts.
/// Past `DEVICE_CLAUSES` the rest of the device changes are one clause.
fn track_moves(before: &SetMeta, after: &SetMeta) -> TrackMoves {
    let (Some(was), Some(now)) = (&before.structure, &after.structure) else {
        return TrackMoves::default();
    };
    let mut used_before = vec![false; was.tracks.len()];
    let mut matched: Vec<Option<usize>> = vec![None; now.tracks.len()];

    // First pass: pair tracks with matching explicit DAW ids.
    for (now_idx, track) in now.tracks.iter().enumerate() {
        let Some(track_id) = track.id else {
            continue;
        };
        if let Some((was_idx, _)) = was
            .tracks
            .iter()
            .enumerate()
            .find(|(idx, earlier)| !used_before[*idx] && earlier.id == Some(track_id))
        {
            used_before[was_idx] = true;
            matched[now_idx] = Some(was_idx);
        }
    }

    // Second pass: pair remaining tracks by name occurrence without crossing distinct ids.
    for (now_idx, track) in now.tracks.iter().enumerate() {
        if matched[now_idx].is_some() {
            continue;
        }
        if let Some((was_idx, _)) = was.tracks.iter().enumerate().find(|(idx, earlier)| {
            !used_before[*idx]
                && earlier.name == track.name
                && (earlier.id.is_none() || track.id.is_none() || earlier.id == track.id)
        }) {
            used_before[was_idx] = true;
            matched[now_idx] = Some(was_idx);
        }
    }

    let mut moves = TrackMoves::default();
    let mut device_changes = 0;
    for (now_idx, track) in now.tracks.iter().enumerate() {
        let Some(was_idx) = matched[now_idx] else {
            continue;
        };
        let earlier = &was.tracks[was_idx];
        let mut track_explained = false;
        if earlier.name != track.name {
            moves.renames.push(Clause::new(
                ClauseKind::Rename,
                format!("{} \u{2192} {}", earlier.name, track.name),
            ));
            track_explained = true;
        }
        let mut had = device_counts(&earlier.devices);
        let mut added = Vec::new();
        for device in &track.devices {
            if let Some(count) = had.get_mut(device.as_str())
                && *count > 0
            {
                *count -= 1;
            } else {
                added.push(format!("+{device} on {}", track.name));
            }
        }
        let mut has = device_counts(&track.devices);
        let mut removed = Vec::new();
        for device in &earlier.devices {
            if let Some(count) = has.get_mut(device.as_str())
                && *count > 0
            {
                *count -= 1;
            } else {
                removed.push(format!("\u{2212}{device} on {}", track.name));
            }
        }
        for text in added.into_iter().chain(removed) {
            track_explained = true;
            if moves.devices.len() < DEVICE_CLAUSES {
                moves.devices.push(Clause::new(ClauseKind::Devices, text));
            } else {
                device_changes += 1;
            }
        }
        if track_explained {
            *moves.explained.entry(track.name.clone()).or_insert(0) += 1;
        }
    }
    if device_changes > 0 {
        let plural = if device_changes == 1 { "" } else { "s" };
        moves.devices.push(Clause::new(
            ClauseKind::Devices,
            format!("{device_changes} device change{plural}"),
        ));
    }
    moves
}

/// The audio and MIDI clip counts that moved, as `+3 audio clips`.
fn clip_clauses(before: &SetMeta, after: &SetMeta) -> Vec<Clause> {
    let (Some(was), Some(now)) = (
        before.structure.as_ref().and_then(|s| s.clips),
        after.structure.as_ref().and_then(|s| s.clips),
    ) else {
        return Vec::new();
    };
    [
        ("audio clip", was.audio, now.audio),
        ("midi clip", was.midi, now.midi),
    ]
    .into_iter()
    .filter(|(_, was, now)| was != now)
    .map(|(noun, was, now)| Clause::new(ClauseKind::Clips, signed(now - was, noun)))
    .collect()
}

/// The sample files the set references that it did not, and the other way round, as `+1 sample`.
fn sample_clauses(before: &SetMeta, after: &SetMeta) -> Vec<Clause> {
    let paths = |meta: &SetMeta| -> HashSet<String> {
        meta.sample_paths.iter().flatten().cloned().collect()
    };
    let (was, now) = (paths(before), paths(after));
    [
        now.difference(&was).count() as i64,
        -(was.difference(&now).count() as i64),
    ]
    .into_iter()
    .filter(|count| *count != 0)
    .map(|count| Clause::new(ClauseKind::Samples, signed(count, "sample")))
    .collect()
}

/// The parts of a suggested commit message, in the order they read: tracks added and removed, renames, devices
/// gained and lost, tracks and parts whose content changed, then the set's tempo, time signature, key, scenes and
/// DAW version, its clip counts, the sample files it references, and the sample files whose bytes changed. The
/// words are the web's save chips' (`diffSaves` in `packages/session-diff`) except where the web says nothing: a
/// track edited in a way the metas do not show is `~name`, a replaced sample is `Replaced sample <file>`. Past five
/// clauses the first five stay and the rest are one `and N more`.
///
/// The metas add what the trees cannot: renames and devices (tracks are paired by the DAW's id, so a track renamed
/// and edited at once is still one track) and clip and sample counts. Without both metas there are none of those,
/// nor scalars, and a changed track is `~name`.
pub fn summary_clauses(
    diff: &DiffSummary,
    before: Option<&SetMeta>,
    after: Option<&SetMeta>,
) -> Vec<Clause> {
    let mut clauses = Vec::new();
    for (names, sign) in [(&diff.tracks_added, 1), (&diff.tracks_removed, -1)] {
        if !names.is_empty() {
            let count = names.len() as i64 * sign;
            clauses.push(Clause::new(ClauseKind::Tracks, signed(count, "track")));
        }
    }
    let metas = before.zip(after);
    let mut moves = metas.map_or_else(TrackMoves::default, |(before, after)| {
        track_moves(before, after)
    });
    clauses.extend(moves.renames);
    clauses.extend(moves.devices);
    for name in &diff.tracks_changed {
        if let Some(count) = moves.explained.get_mut(name)
            && *count > 0
        {
            *count -= 1;
            continue;
        }
        clauses.push(Clause::new(ClauseKind::TrackEdit, format!("~{name}")));
    }
    clauses.extend(
        diff.sections_changed
            .iter()
            .map(|tag| Clause::new(ClauseKind::Section, format!("~{tag}"))),
    );
    clauses.extend(diff.scalars.iter().filter_map(|change| {
        Scalar::named(&change.field)?.clause(change.from.as_deref(), change.to.as_deref()?)
    }));
    if let Some((before, after)) = metas {
        clauses.extend(clip_clauses(before, after));
        clauses.extend(sample_clauses(before, after));
    }
    clauses.extend(
        diff.samples_replaced
            .iter()
            .map(|name| Clause::new(ClauseKind::SampleBytes, format!("Replaced sample {name}"))),
    );
    if clauses.len() > SUMMARY_ITEMS {
        let left_out = clauses.len() - SUMMARY_ITEMS;
        clauses.truncate(SUMMARY_ITEMS);
        clauses.push(Clause::new(
            ClauseKind::More,
            format!("and {left_out} more"),
        ));
    }
    clauses
}

/// [`summary_clauses`] as one line for a commit message: the clauses joined with `, `, or `no changes`.
pub fn summary_line(
    diff: &DiffSummary,
    before: Option<&SetMeta>,
    after: Option<&SetMeta>,
) -> String {
    let clauses = summary_clauses(diff, before, after);
    if clauses.is_empty() {
        return "no changes".to_owned();
    }
    clauses
        .iter()
        .map(|clause| clause.text.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(feature = "store")]
mod repo_diff {
    use std::path::Path;

    use super::{Clause, DiffSummary, diff_trees, summary_clauses};
    use crate::repo::{Repo, RepoError, Save};
    use crate::store::read_tree_object;

    /// The file name of each tracked sample `later` holds other bytes for than `earlier`, once each, in `later`'s
    /// order. A sample `earlier` did not reference at all was added, not replaced; one it referenced untracked
    /// (missing then) and `later` has bytes for counts.
    fn replaced_samples(earlier: &Save, later: &Save) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for sample in &later.samples {
            let (Some(relative), Some(object)) = (&sample.relative, &sample.object) else {
                continue;
            };
            let held = earlier
                .samples
                .iter()
                .find(|held| held.relative.as_ref() == Some(relative));
            if held.is_none_or(|held| held.object.as_ref() == Some(object)) {
                continue;
            }
            let name = Path::new(relative).file_name().map_or_else(
                || relative.clone(),
                |name| name.to_string_lossy().into_owned(),
            );
            if !names.contains(&name) {
                names.push(name);
            }
        }
        names
    }

    impl Repo {
        /// What changed from save `a` to save `b`: their trees are read as
        /// objects (never their leaves) and compared with each save's meta, and
        /// the samples whose bytes differ are named. A
        /// save that holds its file whole has no tree: `RepoError::NoDocument`.
        pub fn diff(&self, a: &Save, b: &Save) -> Result<DiffSummary, RepoError> {
            let (a_tree, _) = a.document().ok_or(RepoError::NoDocument)?;
            let (b_tree, _) = b.document().ok_or(RepoError::NoDocument)?;
            let a_tree = read_tree_object(self.store(), a_tree)?;
            let b_tree = read_tree_object(self.store(), b_tree)?;
            let mut summary = diff_trees(&a_tree, a.meta.as_ref(), &b_tree, b.meta.as_ref());
            summary.samples_replaced = replaced_samples(a, b);
            Ok(summary)
        }

        /// The clauses of the suggested message for the change from `a` to `b`: [`Repo::diff`] worded by
        /// [`summary_clauses`] with each save's meta.
        pub fn clauses(&self, a: &Save, b: &Save) -> Result<Vec<Clause>, RepoError> {
            Ok(summary_clauses(
                &self.diff(a, b)?,
                a.meta.as_ref(),
                b.meta.as_ref(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::{SetStructure, StructureTrack, TrackKind};
    use crate::store::{LeafEntry, ObjectId, ObjectKind};
    use crate::tree::LeafKind;

    fn leaf(text: &str) -> LeafEntry {
        LeafEntry {
            kind: LeafKind::Text,
            tag: None,
            object: ObjectId::of(ObjectKind::Blob, text.as_bytes()),
        }
    }

    fn part(kind: PartKind, tag: &str, id: Option<&str>, content: &str) -> PartEntry {
        PartEntry {
            kind,
            tag: Some(tag.to_owned()),
            id: id.map(str::to_owned),
            leaves: vec![leaf(content)],
        }
    }

    fn track(id: &str, content: &str) -> PartEntry {
        part(PartKind::Track, "AudioTrack", Some(id), content)
    }

    fn section(tag: &str, content: &str) -> PartEntry {
        part(PartKind::Section, tag, None, content)
    }

    fn gap(content: &str) -> PartEntry {
        PartEntry {
            kind: PartKind::Gap,
            tag: None,
            id: None,
            leaves: vec![leaf(content)],
        }
    }

    fn tree(parts: Vec<PartEntry>) -> TreeObject {
        TreeObject { parts }
    }

    fn named(id: i64, name: &str) -> StructureTrack {
        StructureTrack {
            kind: TrackKind::Audio,
            name: name.to_owned(),
            devices: vec![],
            id: Some(id),
            group_id: None,
            color: None,
        }
    }

    fn meta_with_tracks(tracks: Vec<StructureTrack>) -> SetMeta {
        SetMeta {
            structure: Some(SetStructure {
                tracks,
                clips: None,
                scenes: None,
                plugins: None,
                truncated: None,
            }),
            ..SetMeta::default()
        }
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn identical_trees_and_metas_give_an_empty_diff() {
        let t = tree(vec![gap("g"), track("1", "kick"), section("Locators", "l")]);
        let meta = SetMeta {
            tempo: Some("120".into()),
            ..SetMeta::default()
        };
        let diff = diff_trees(&t, Some(&meta), &t.clone(), Some(&meta.clone()));
        assert_eq!(diff, DiffSummary::default());
        assert_eq!(summary_line(&diff, Some(&meta), Some(&meta)), "no changes");
    }

    #[test]
    fn a_track_only_in_b_is_added_and_one_only_in_a_is_removed() {
        let a = tree(vec![track("1", "kick"), track("2", "snare")]);
        let b = tree(vec![track("1", "kick"), track("3", "hat")]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.tracks_added, strings(&["AudioTrack 3"]));
        assert_eq!(diff.tracks_removed, strings(&["AudioTrack 2"]));
        assert!(diff.tracks_changed.is_empty());
    }

    #[test]
    fn a_track_with_a_different_digest_is_changed() {
        let a = tree(vec![track("1", "kick"), track("2", "snare")]);
        let b = tree(vec![track("1", "kick"), track("2", "snare v2")]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.tracks_changed, strings(&["AudioTrack 2"]));
        assert!(diff.tracks_added.is_empty() && diff.tracks_removed.is_empty());
    }

    #[test]
    fn a_track_whose_id_changed_with_identical_content_is_removed_and_added() {
        let a = tree(vec![track("1", "same")]);
        let b = tree(vec![track("9", "same")]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.tracks_removed, strings(&["AudioTrack 1"]));
        assert_eq!(diff.tracks_added, strings(&["AudioTrack 9"]));
        assert!(diff.tracks_changed.is_empty());
    }

    #[test]
    fn tracks_without_an_id_pair_by_position_among_their_tag() {
        let idless = |content| part(PartKind::Track, "MidiTrack", None, content);
        let a = tree(vec![idless("one"), track("5", "x"), idless("two")]);
        let b = tree(vec![idless("one"), idless("two changed"), track("5", "x")]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.tracks_changed, strings(&["MidiTrack"]));
        assert!(diff.tracks_added.is_empty() && diff.tracks_removed.is_empty());
    }

    #[test]
    fn repeated_ids_pair_by_occurrence() {
        let a = tree(vec![track("1", "a"), track("1", "b")]);
        let b = tree(vec![track("1", "a")]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.tracks_removed, strings(&["AudioTrack 1"]));
    }

    #[test]
    fn tracks_are_named_from_the_structure_of_the_side_they_come_from() {
        let a_meta = meta_with_tracks(vec![named(2, "Old Snare"), named(1, "Kick")]);
        let b_meta = meta_with_tracks(vec![named(1, "Kick Renamed"), named(3, "Hat")]);
        let a = tree(vec![track("1", "kick"), track("2", "snare")]);
        let b = tree(vec![track("1", "kick v2"), track("3", "hat")]);
        let diff = diff_trees(&a, Some(&a_meta), &b, Some(&b_meta));
        assert_eq!(diff.tracks_added, strings(&["Hat"]));
        assert_eq!(diff.tracks_removed, strings(&["Old Snare"]));
        assert_eq!(diff.tracks_changed, strings(&["Kick Renamed"]));
    }

    #[test]
    fn a_track_falls_back_to_tag_and_id_without_a_match_and_to_the_tag_without_an_id() {
        let meta = meta_with_tracks(vec![named(7, "Seven")]);
        let non_numeric = track("abc", "x");
        assert_eq!(track_name(&non_numeric, Some(&meta)), "AudioTrack abc");
        assert_eq!(track_name(&track("8", "x"), Some(&meta)), "AudioTrack 8");
        assert_eq!(
            track_name(&track("7", "x"), Some(&SetMeta::default())),
            "AudioTrack 7"
        );
        let no_id = part(PartKind::Track, "MidiTrack", None, "x");
        assert_eq!(track_name(&no_id, Some(&meta)), "MidiTrack");
    }

    #[test]
    fn a_changed_added_or_removed_section_is_listed_by_tag_and_gaps_are_ignored() {
        let a = tree(vec![
            gap("before"),
            section("Locators", "l"),
            section("Scenes", "s"),
            section("Gone", "g"),
        ]);
        let b = tree(vec![
            gap("different gap"),
            section("Locators", "l"),
            section("Scenes", "s2"),
            section("New", "n"),
        ]);
        let diff = diff_trees(&a, None, &b, None);
        assert_eq!(diff.sections_changed, strings(&["Scenes", "New", "Gone"]));
        assert!(diff.tracks_changed.is_empty());
    }

    #[test]
    fn scalars_report_the_fields_that_differ_in_order() {
        let a = SetMeta {
            tempo: Some("120".into()),
            time_signature: Some("4/4".into()),
            root_note: Some("C".into()),
            scale: Some("Minor".into()),
            scenes_count: Some(8),
            daw_version: Some("12.0".into()),
            ..SetMeta::default()
        };
        let b = SetMeta {
            tempo: Some("124".into()),
            time_signature: Some("3/4".into()),
            root_note: Some("C".into()),
            scale: Some("Major".into()),
            scenes_count: Some(9),
            daw_version: None,
            ..SetMeta::default()
        };
        let t = tree(vec![]);
        let diff = diff_trees(&t, Some(&a), &t, Some(&b));
        let change = |field: &str, from: Option<&str>, to: Option<&str>| ScalarChange {
            field: field.to_owned(),
            from: from.map(str::to_owned),
            to: to.map(str::to_owned),
        };
        assert_eq!(
            diff.scalars,
            vec![
                change("tempo", Some("120"), Some("124")),
                change("time signature", Some("4/4"), Some("3/4")),
                change("key", Some("C Minor"), Some("C Major")),
                change("scenes", Some("8"), Some("9")),
                change("Live", Some("12.0"), None),
            ]
        );
        assert_eq!(
            summary_line(&diff, Some(&a), Some(&b)),
            "tempo 120 → 124, time sig 4/4 → 3/4, key C Minor → C Major, +1 scene"
        );
    }

    #[test]
    fn a_key_with_only_one_of_root_and_scale_reads_as_that_part() {
        let a = SetMeta::default();
        let b = SetMeta {
            root_note: Some("F".into()),
            ..SetMeta::default()
        };
        let t = tree(vec![]);
        let diff = diff_trees(&t, Some(&a), &t, Some(&b));
        assert_eq!(diff.scalars.len(), 1);
        assert_eq!(diff.scalars[0].to.as_deref(), Some("F"));
        assert_eq!(summary_line(&diff, Some(&a), Some(&b)), "key — → F");
    }

    #[test]
    fn scalars_are_empty_unless_both_sides_have_meta() {
        let with = SetMeta {
            tempo: Some("120".into()),
            ..SetMeta::default()
        };
        let t = tree(vec![]);
        assert!(diff_trees(&t, Some(&with), &t, None).scalars.is_empty());
        assert!(diff_trees(&t, None, &t, Some(&with)).scalars.is_empty());
    }

    #[test]
    fn the_summary_line_counts_tracks_and_uses_the_singular_for_one() {
        let one = DiffSummary {
            tracks_added: strings(&["A"]),
            tracks_removed: strings(&["B"]),
            ..DiffSummary::default()
        };
        assert_eq!(summary_line(&one, None, None), "+1 track, \u{2212}1 track");
        let many = DiffSummary {
            tracks_added: strings(&["A", "B"]),
            tracks_changed: strings(&["Bass"]),
            sections_changed: strings(&["Locators"]),
            scalars: vec![ScalarChange {
                field: "tempo".into(),
                from: Some("120".into()),
                to: Some("124".into()),
            }],
            ..DiffSummary::default()
        };
        assert_eq!(
            summary_line(&many, None, None),
            "+2 tracks, ~Bass, ~Locators, tempo 120 → 124"
        );
    }

    #[test]
    fn five_items_are_named_in_full_and_more_fold_into_and_n_more() {
        let five = DiffSummary {
            tracks_changed: strings(&["A", "B", "C", "D", "E"]),
            ..DiffSummary::default()
        };
        assert_eq!(summary_line(&five, None, None), "~A, ~B, ~C, ~D, ~E");
        let eight = DiffSummary {
            tracks_added: strings(&["N"]),
            tracks_changed: strings(&["A", "B", "C", "D", "E", "F"]),
            sections_changed: strings(&["S"]),
            ..DiffSummary::default()
        };
        assert_eq!(
            summary_line(&eight, None, None),
            "+1 track, ~A, ~B, ~C, ~D, and 3 more"
        );
    }

    #[test]
    fn a_summary_serialises_in_camel_case() {
        let value = serde_json::to_value(DiffSummary::default()).unwrap();
        for key in [
            "tracksAdded",
            "tracksRemoved",
            "tracksChanged",
            "sectionsChanged",
            "scalars",
            "samplesReplaced",
        ] {
            assert!(value.get(key).is_some(), "{key}");
        }
    }

    /// The suggested message's grammar, row by row against the web's save chips (`diffSaves` in
    /// `packages/session-diff`, whose `index.test.ts` the expected words are copied from).
    mod clauses {
        use super::*;
        use crate::meta::{ClipCounts, SetStructure, StructureTrack, TrackKind};
        use serde_json::json;

        fn track(id: i64, name: &str, devices: &[&str]) -> StructureTrack {
            StructureTrack {
                kind: TrackKind::Audio,
                name: name.to_owned(),
                devices: devices.iter().map(|d| (*d).to_owned()).collect(),
                id: Some(id),
                group_id: None,
                color: None,
            }
        }

        fn set(tracks: Vec<StructureTrack>) -> SetMeta {
            SetMeta {
                structure: Some(SetStructure {
                    tracks,
                    clips: Some(ClipCounts { audio: 0, midi: 0 }),
                    scenes: None,
                    plugins: None,
                    truncated: None,
                }),
                ..SetMeta::default()
            }
        }

        fn words(diff: &DiffSummary, before: &SetMeta, after: &SetMeta) -> Vec<String> {
            summary_clauses(diff, Some(before), Some(after))
                .into_iter()
                .map(|clause| clause.text)
                .collect()
        }

        /// What `diff_trees` makes of two metas with no tree difference.
        fn scalar_words(before: &SetMeta, after: &SetMeta) -> Vec<String> {
            let empty = tree(vec![]);
            let diff = diff_trees(&empty, Some(before), &empty, Some(after));
            words(&diff, before, after)
        }

        #[test]
        fn tracks_added_and_removed_are_counted_with_the_singular_for_one() {
            let diff = DiffSummary {
                tracks_added: strings(&["Keys", "Perc"]),
                tracks_removed: strings(&["Bass"]),
                ..DiffSummary::default()
            };
            assert_eq!(
                words(&diff, &SetMeta::default(), &SetMeta::default()),
                ["+2 tracks", "\u{2212}1 track"]
            );
        }

        #[test]
        fn a_device_gained_or_lost_is_named_with_its_track() {
            let before = set(vec![
                track(1, "Bass", &["Saturator"]),
                track(2, "Vox", &["Reverb", "Compressor"]),
            ]);
            let after = set(vec![
                track(1, "Bass", &["Saturator", "EQ Eight"]),
                track(2, "Vox", &["Compressor"]),
            ]);
            let diff = DiffSummary {
                tracks_changed: strings(&["Bass", "Vox"]),
                ..DiffSummary::default()
            };
            assert_eq!(
                words(&diff, &before, &after),
                ["+EQ Eight on Bass", "\u{2212}Reverb on Vox"],
                "no ~Bass or ~Vox: the devices say what changed"
            );
        }

        #[test]
        fn device_changes_past_the_third_are_summed() {
            let before = set(vec![track(1, "A", &[]), track(2, "B", &[])]);
            let after = set(vec![
                track(1, "A", &["d1", "d2"]),
                track(2, "B", &["d3", "d4", "d5"]),
            ]);
            let diff = DiffSummary::default();
            assert_eq!(
                words(&diff, &before, &after),
                ["+d1 on A", "+d2 on A", "+d3 on B", "2 device changes"]
            );
            let one_more = set(vec![
                track(1, "A", &["d1", "d2"]),
                track(2, "B", &["d3", "d4"]),
            ]);
            assert_eq!(
                words(&diff, &before, &one_more),
                ["+d1 on A", "+d2 on A", "+d3 on B", "1 device change"]
            );
        }

        #[test]
        fn a_renamed_track_is_old_to_new_and_not_also_an_edit() {
            let before = set(vec![track(1, "Old", &["EQ Eight"]), track(2, "Keep", &[])]);
            let after = set(vec![track(1, "New", &["EQ Eight"]), track(2, "Keep", &[])]);
            let diff = DiffSummary {
                tracks_changed: strings(&["New"]),
                ..DiffSummary::default()
            };
            assert_eq!(words(&diff, &before, &after), ["Old \u{2192} New"]);
        }

        #[test]
        fn a_track_renamed_and_given_a_device_at_once_is_still_one_track() {
            let before = set(vec![track(1, "Old", &[])]);
            let after = set(vec![track(1, "New", &["Reverb"])]);
            let diff = DiffSummary {
                tracks_changed: strings(&["New"]),
                ..DiffSummary::default()
            };
            assert_eq!(
                words(&diff, &before, &after),
                ["Old \u{2192} New", "+Reverb on New"]
            );
        }

        #[test]
        fn a_track_edited_with_nothing_the_metas_show_is_a_tilde_clause() {
            let both = set(vec![track(1, "Bass", &["Saturator"])]);
            let diff = DiffSummary {
                tracks_changed: strings(&["Bass"]),
                sections_changed: strings(&["Locators"]),
                ..DiffSummary::default()
            };
            assert_eq!(words(&diff, &both, &both), ["~Bass", "~Locators"]);
            assert_eq!(
                summary_clauses(&diff, None, None)
                    .iter()
                    .map(|c| c.kind)
                    .collect::<Vec<_>>(),
                [ClauseKind::TrackEdit, ClauseKind::Section],
                "with no metas there is nothing else to say"
            );
        }

        #[test]
        fn the_musical_fields_are_transitions() {
            let meta = |tempo: &str, signature: &str, scale: &str| SetMeta {
                tempo: Some(tempo.into()),
                time_signature: Some(signature.into()),
                root_note: Some("A".into()),
                scale: Some(scale.into()),
                ..SetMeta::default()
            };
            assert_eq!(
                scalar_words(&meta("126", "4/4", "Minor"), &meta("128", "3/4", "Major")),
                [
                    "tempo 126 \u{2192} 128",
                    "time sig 4/4 \u{2192} 3/4",
                    "key A Minor \u{2192} A Major"
                ]
            );
            let root_only = SetMeta {
                root_note: Some("C".into()),
                ..meta("126", "4/4", "Minor")
            };
            assert_eq!(
                scalar_words(&meta("126", "4/4", "Minor"), &root_only),
                ["key A Minor \u{2192} C Minor"],
                "the root note and scale are one key"
            );
        }

        #[test]
        fn a_tempo_is_a_number_not_a_string() {
            let tempo = |text: &str| SetMeta {
                tempo: Some(text.into()),
                ..SetMeta::default()
            };
            assert!(scalar_words(&tempo("126"), &tempo("126.0")).is_empty());
            assert_eq!(
                scalar_words(&tempo("120.0"), &tempo("124.50")),
                ["tempo 120 \u{2192} 124.5"]
            );
        }

        #[test]
        fn a_value_with_no_before_reads_as_a_dash_and_one_that_went_away_is_not_worded() {
            let blank = SetMeta::default();
            let keyed = SetMeta {
                root_note: Some("F".into()),
                tempo: Some("120".into()),
                ..SetMeta::default()
            };
            assert_eq!(
                scalar_words(&blank, &keyed),
                ["tempo \u{2014} \u{2192} 120", "key \u{2014} \u{2192} F"]
            );
            assert!(scalar_words(&keyed, &blank).is_empty());
        }

        #[test]
        fn scenes_are_a_signed_count_and_the_daw_version_a_bare_transition() {
            let meta = |scenes: i64, daw: &str| SetMeta {
                scenes_count: Some(scenes),
                daw_version: Some(daw.into()),
                ..SetMeta::default()
            };
            assert_eq!(
                scalar_words(
                    &meta(8, "Ableton Live 12.3"),
                    &meta(10, "Ableton Live 12.4")
                ),
                ["+2 scenes", "Ableton Live 12.3 \u{2192} Ableton Live 12.4"]
            );
            assert_eq!(
                scalar_words(&meta(8, "x"), &meta(7, "x")),
                ["\u{2212}1 scene"]
            );
        }

        #[test]
        fn clips_and_sample_files_are_signed_counts() {
            let mut before = set(vec![]);
            let mut after = set(vec![]);
            before.structure.as_mut().unwrap().clips = Some(ClipCounts { audio: 4, midi: 3 });
            after.structure.as_mut().unwrap().clips = Some(ClipCounts { audio: 7, midi: 2 });
            before.sample_paths = Some(strings(&["a.wav", "b.wav"]));
            after.sample_paths = Some(strings(&["b.wav", "c.wav", "d.wav"]));
            assert_eq!(
                words(&DiffSummary::default(), &before, &after),
                [
                    "+3 audio clips",
                    "\u{2212}1 midi clip",
                    "+2 samples",
                    "\u{2212}1 sample"
                ]
            );
        }

        #[test]
        fn the_spec_example_reads_in_order() {
            let before = set(vec![track(1, "Bass", &[])]);
            let mut after = set(vec![track(1, "Bass", &["EQ Eight"])]);
            after.tempo = Some("124".into());
            let mut before = before;
            before.tempo = Some("120".into());
            let diff = DiffSummary {
                tracks_added: strings(&["Keys", "Perc"]),
                tracks_changed: strings(&["Bass"]),
                scalars: scalars(&before, &after),
                ..DiffSummary::default()
            };
            assert_eq!(
                summary_line(&diff, Some(&before), Some(&after)),
                "+2 tracks, +EQ Eight on Bass, tempo 120 \u{2192} 124"
            );
        }

        #[test]
        fn a_replaced_sample_is_named_by_its_file() {
            let diff = DiffSummary {
                samples_replaced: strings(&["kick.wav", "snare.wav"]),
                ..DiffSummary::default()
            };
            assert_eq!(
                summary_line(&diff, None, None),
                "Replaced sample kick.wav, Replaced sample snare.wav"
            );
        }

        #[test]
        fn clauses_past_five_fold_into_and_n_more_and_the_kinds_say_what_each_is() {
            let diff = DiffSummary {
                tracks_added: strings(&["N"]),
                tracks_changed: strings(&["A", "B", "C", "D", "E", "F"]),
                ..DiffSummary::default()
            };
            let clauses = summary_clauses(&diff, None, None);
            assert_eq!(clauses.len(), 6);
            assert_eq!(
                clauses[5],
                Clause {
                    kind: ClauseKind::More,
                    text: "and 2 more".into()
                }
            );
            assert_eq!(clauses[0].kind, ClauseKind::Tracks);
            assert_eq!(
                summary_line(&diff, None, None),
                clauses
                    .iter()
                    .map(|c| c.text.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                "the line is the clauses joined"
            );
        }

        #[test]
        fn no_clauses_is_no_changes_and_a_clause_serialises_in_camel_case() {
            assert_eq!(
                summary_line(&DiffSummary::default(), None, None),
                "no changes"
            );
            assert_eq!(
                serde_json::to_value(Clause {
                    kind: ClauseKind::TimeSignature,
                    text: "time sig 4/4 \u{2192} 3/4".into()
                })
                .unwrap(),
                json!({ "kind": "timeSignature", "text": "time sig 4/4 \u{2192} 3/4" })
            );
        }
    }

    #[cfg(feature = "store")]
    mod repo {
        use std::fs;
        use std::path::{Path, PathBuf};

        use super::super::{DiffSummary, summary_line};
        use crate::daw::{Backup, Daw, DawError};
        use crate::meta::SetMeta;
        use crate::repo::Repo;
        use crate::tree::{Leaf, LeafKind, Part, PartKind, Tree};

        const MARKER: &[u8] = b"TEST\n";

        /// A DAW whose document is one Track part per line, tagged `Track` and
        /// identified by line number. Masking moves whatever follows `stamp=`
        /// to the side list.
        struct FakeDaw;

        static DAW: FakeDaw = FakeDaw;

        impl Daw for FakeDaw {
            fn id(&self) -> &'static str {
                "fake"
            }
            fn display_name(&self) -> &'static str {
                "Fake"
            }
            fn set_extensions(&self) -> &'static [&'static str] {
                &["fset"]
            }
            fn managed_subfolders(&self) -> &'static [&'static str] {
                &[]
            }
            fn is_project_folder(&self, dir: &Path) -> bool {
                dir.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(" Project"))
            }
            fn find_sets(&self, _: &Path) -> std::io::Result<Vec<PathBuf>> {
                Ok(vec![])
            }
            fn decode(&self, file: &[u8]) -> Result<Vec<u8>, DawError> {
                file.strip_prefix(MARKER)
                    .map(<[u8]>::to_vec)
                    .ok_or_else(|| DawError::Corrupt("missing marker".into()))
            }
            fn encode(&self, doc: &[u8]) -> Result<Vec<u8>, DawError> {
                Ok([MARKER, doc].concat())
            }
            fn split(&self, doc: &[u8]) -> Result<Tree, DawError> {
                let text = std::str::from_utf8(doc)
                    .map_err(|_| DawError::Malformed("not utf-8".into()))?;
                let parts = text
                    .lines()
                    .enumerate()
                    .map(|(at, line)| Part {
                        kind: PartKind::Track,
                        tag: Some("Track".into()),
                        id: Some(at.to_string()),
                        leaves: vec![Leaf {
                            kind: LeafKind::Text,
                            tag: None,
                            bytes: line.as_bytes().to_vec(),
                        }],
                    })
                    .collect();
                Ok(Tree { parts })
            }
            fn mask(&self, text: &[u8], side: &mut Vec<String>) -> Vec<u8> {
                let text = std::str::from_utf8(text).unwrap();
                match text.split_once("stamp=") {
                    Some((head, value)) => {
                        side.push(value.to_owned());
                        format!("{head}stamp=@").into_bytes()
                    }
                    None => text.as_bytes().to_vec(),
                }
            }
            fn unmask(&self, doc: &[u8], _: &[String]) -> Result<(Vec<u8>, usize), DawError> {
                Ok((doc.to_vec(), 0))
            }
            fn parse(&self, doc: &[u8]) -> Result<SetMeta, DawError> {
                let tempo = std::str::from_utf8(doc)
                    .ok()
                    .and_then(|text| text.lines().next())
                    .map(str::to_owned);
                Ok(SetMeta {
                    tempo,
                    ..SetMeta::default()
                })
            }
            fn list_backups(&self, _: &Path) -> std::io::Result<Vec<Backup>> {
                Ok(vec![])
            }
        }

        fn record(repo: &Repo, doc: &str) -> crate::repo::Save {
            let path = repo.root().join("Song.fset");
            fs::write(&path, [MARKER, doc.as_bytes()].concat()).unwrap();
            let id = repo.record_save(&path).unwrap().unwrap();
            repo.read_save(&id).unwrap()
        }

        fn repo() -> (tempfile::TempDir, Repo) {
            let root = tempfile::tempdir().unwrap();
            let dir = root.path().join("Song Project");
            fs::create_dir_all(&dir).unwrap();
            let repo = Repo::init(&dir, &DAW).unwrap();
            (root, repo)
        }

        #[test]
        fn two_recorded_saves_differ_in_the_track_that_changed_and_in_meta() {
            let (_root, repo) = repo();
            let a = record(&repo, "120\nkick\nsnare");
            let b = record(&repo, "124\nkick\nsnare v2\nhat");
            let diff = repo.diff(&a, &b).unwrap();
            assert_eq!(diff.tracks_added, vec!["Track 3".to_owned()]);
            assert_eq!(
                diff.tracks_changed,
                vec!["Track 0".to_owned(), "Track 2".to_owned()]
            );
            assert_eq!(diff.scalars.len(), 1);
            assert_eq!(diff.scalars[0].field, "tempo");
        }

        #[test]
        fn a_view_only_pair_of_recorded_saves_has_an_empty_diff() {
            let (_root, repo) = repo();
            let a = record(&repo, "120\nkick stamp=111");
            let b = record(&repo, "120\nkick stamp=222");
            assert!(b.view_only);
            let diff = repo.diff(&a, &b).unwrap();
            assert_eq!(diff, DiffSummary::default());
            assert_eq!(
                summary_line(&diff, a.meta.as_ref(), b.meta.as_ref()),
                "no changes"
            );
        }

        #[test]
        fn a_save_whose_tree_is_missing_is_a_store_error() {
            let (_root, repo) = repo();
            let a = record(&repo, "120\nkick");
            let mut b = a.clone();
            b.tree = Some(crate::store::ObjectId::of(
                crate::store::ObjectKind::Tree,
                b"absent",
            ));
            assert!(matches!(
                repo.diff(&a, &b),
                Err(crate::repo::RepoError::Store(_))
            ));
        }

        #[test]
        fn a_save_whose_tree_id_names_another_kind_of_object_is_malformed() {
            let (_root, repo) = repo();
            let a = record(&repo, "120\nkick");
            let mut b = a.clone();
            b.tree = a.side;
            assert!(matches!(
                repo.diff(&a, &b),
                Err(crate::repo::RepoError::Store(
                    crate::store::StoreError::Malformed(_)
                ))
            ));
        }
    }

    #[test]
    fn a_branchs_first_commit_is_suggested_as_one_initial_clause() {
        let clauses = initial_clauses();
        assert_eq!(
            clauses,
            [Clause {
                kind: ClauseKind::Initial,
                text: "Initial commit".to_string()
            }]
        );
        assert_eq!(clauses[0].text, INITIAL_COMMIT);
    }

    #[test]
    fn device_diffing_is_multiset_aware_and_disambiguates_duplicate_track_names() {
        let with_devices = |id: Option<i64>, name: &str, devices: &[&str]| StructureTrack {
            kind: TrackKind::Audio,
            name: name.to_owned(),
            devices: devices.iter().map(|d| (*d).to_owned()).collect(),
            id,
            group_id: None,
            color: None,
        };
        let a_meta = meta_with_tracks(vec![
            with_devices(Some(1), "Audio", &["EQ Eight"]),
            with_devices(Some(2), "Audio", &["Reverb", "Reverb"]),
        ]);
        let b_meta = meta_with_tracks(vec![
            with_devices(Some(1), "Audio", &["EQ Eight", "EQ Eight"]),
            with_devices(Some(2), "Audio", &["Reverb"]),
        ]);
        let a = tree(vec![track("1", "a1"), track("2", "a2")]);
        let b = tree(vec![track("1", "b1"), track("2", "b2")]);
        let diff = diff_trees(&a, Some(&a_meta), &b, Some(&b_meta));
        let line = summary_line(&diff, Some(&a_meta), Some(&b_meta));
        assert_eq!(line, "+EQ Eight on Audio, \u{2212}Reverb on Audio");

        // When one duplicate-named track gains a device and the other only edits XML,
        // the second track still reports `~Audio` instead of being swallowed.
        let b_meta_one_dev = meta_with_tracks(vec![
            with_devices(Some(1), "Audio", &["EQ Eight", "EQ Eight"]),
            with_devices(Some(2), "Audio", &["Reverb", "Reverb"]),
        ]);
        let diff_one_dev = diff_trees(&a, Some(&a_meta), &b, Some(&b_meta_one_dev));
        let line_one_dev = summary_line(&diff_one_dev, Some(&a_meta), Some(&b_meta_one_dev));
        assert_eq!(line_one_dev, "+EQ Eight on Audio, ~Audio");
    }
}
