//! How likely an audio file is a bounce of a track: how alike its name is to the names the track goes by, and how
//! much where and when it was made supports that.
//!
//! The model combines title similarity, confidence (identity, support, locality and timing) and eligibility (the
//! shortest-render floor). Three quantities in `[0, 1]` combine:
//!
//! - identity: is this file this song? Read off its name ([`title_similarity`], [`name_specificity`]).
//! - locality: did it come out of this set? Read off where it sits ([`Place`]).
//! - timing: was it made around a save of this set? ([`timing_of`]).
//!
//! Support (the best of locality, timing and, here, closeness to the track's current version) lifts a plausible
//! identity and never creates one: a sample dropped in a project folder stays where its name puts it, and a
//! generically named bounce beside a save is reached although nothing in its name says the song.
//!
//! Left out of the port: the title corpus (document-frequency weights across a whole library; a daemon scores one
//! file against a few names), folder pins and match memory (the ledger keeps rejections by fingerprint and the
//! folders a producer excluded), imported-sample detection (a Live set's samples are tracked by the repo), the
//! shared-folder check (it compares several sessions at once), the managed-folder test of locality (the folder
//! rules keep those files from being offered at all) and the review's listing and link-source labels (a score
//! carries its reasons as sentences instead). The edit-distance and Jaro-Winkler measures are `strsim`'s.

use std::path::Path;

use serde::{Deserialize, Serialize};
use strsim::{jaro_winkler, normalized_levenshtein};

/// A name with nothing song-specific in it neither claims a song nor denies one.
pub const NEUTRAL_IDENTITY: f64 = 0.5;

/// Below this share of song-specific words, a name is read as saying nothing.
pub const SPECIFIC_NAME: f64 = 0.2;

/// A name score at or above this says outright which song a file is. It keeps a deliberately short bounce (an
/// intro, a snippet, a teaser) out of the shortest-render floor.
pub const STRONG_IDENTITY: f64 = 0.85;

/// A name similarity at or above this names a track outright.
pub const NAMES_A_TRACK: f64 = 0.6;

/// Confidence at or above which a file is worth offering; below it nothing is proposed.
pub const ASK_CONFIDENCE: f64 = 0.45;

/// The default shortest render: shorter audio is not taken for a bounce unless its name says the song.
pub const MIN_RENDER_MS: u64 = 30_000;

/// Distance from the nearest save at which timing has halved.
pub const TIMING_HALF_LIFE_MS: i64 = 12 * 60 * 60 * 1000;

/// The most support can add to an identity.
const SUPPORT_LIFT: f64 = 0.3;

/// Identity below which support counts for nothing, and the span it fades in over.
const GATE_FLOOR: f64 = 0.25;
const GATE_SPAN: f64 = 0.25;

/// Locality by where a file sits relative to the set, best row first.
const EXPORT_FOLDER_LOCALITY: f64 = 1.0;
const PROJECT_SUBFOLDER_LOCALITY: f64 = 0.95;
const SUBFOLDER_DEPTH_DECAY: f64 = 0.85;
const PROJECT_ROOT_LOCALITY: f64 = 0.85;
const SET_FOLDER_LOCALITY: f64 = 0.7;

/// How much support a render as long as the track's current version is worth, at most. It is weaker than every
/// place a bounce lands.
const LENGTH_SUPPORT: f64 = 0.7;

/// What a render in the track's current version's format adds to the support its length gives.
const FORMAT_SUPPORT: f64 = 0.1;

/// Lengths within this share of each other count as close; at a fifth apart the closeness is nothing.
const LENGTH_CLOSE_SHARE: f64 = 0.8;

// Extensions of files a title may carry. A trailing `.<ext>` is only stripped as an extension when it is one of
// these, otherwise a title like `01.Nerve` would lose its `.Nerve` and collapse to `01`.
const KNOWN_EXTENSIONS: [&str; 14] = [
    "wav", "mp3", "aiff", "aif", "flac", "m4a", "aac", "ogg", "als", "alp", "adg", "adv", "agr",
    "wave",
];

// Bounce qualifiers and filler. Present in a large share of both set names and render filenames, so they say almost
// nothing about which song a file is.
fn is_qualifier(token: &str) -> bool {
    matches!(
        token,
        "a" | "alt"
            | "and"
            | "bounce"
            | "comp"
            | "copy"
            | "demo"
            | "done"
            | "draft"
            | "edit"
            | "export"
            | "fin"
            | "final"
            | "in"
            | "it"
            | "its"
            | "master"
            | "mastered"
            | "mix"
            | "mixed"
            | "my"
            | "new"
            | "of"
            | "old"
            | "prefin"
            | "render"
            | "rough"
            | "take"
            | "test"
            | "the"
            | "to"
            | "v"
            | "ver"
            | "version"
            | "wip"
            | "x"
    )
}

// Words that name a part, a stem, or a download's provenance rather than a song. They carry some weight (a set
// really can be called "Intro") but never enough to carry a match on their own.
fn is_generic(token: &str) -> bool {
    matches!(
        token,
        "acapella"
            | "audio"
            | "bass"
            | "beat"
            | "bridge"
            | "chorus"
            | "drum"
            | "drums"
            | "feat"
            | "ft"
            | "guitar"
            | "hat"
            | "instrumental"
            | "intro"
            | "kick"
            | "lyric"
            | "lyrics"
            | "loop"
            | "official"
            | "outro"
            | "piano"
            | "sample"
            | "snare"
            | "song"
            | "stem"
            | "stems"
            | "synth"
            | "track"
            | "untitled"
            | "verse"
            | "video"
            | "vocal"
            | "vocals"
            | "vox"
    )
}

const QUALIFIER_WEIGHT: f64 = 0.15;
const GENERIC_WEIGHT: f64 = 0.35;

/// What a token says about the file it names: a `Word` is the only kind that can name a song, a `Generic` names a
/// part or a stem, a `Qualifier` names a stage of the work, and a `Number` is a take or a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Word,
    Qualifier,
    Generic,
    Number,
}

/// The kind of a normalised token.
pub fn token_kind(token: &str) -> TokenKind {
    if !token.is_empty() && token.chars().all(|c| c.is_ascii_digit()) {
        TokenKind::Number
    } else if is_qualifier(token) {
        TokenKind::Qualifier
    } else if is_generic(token) {
        TokenKind::Generic
    } else {
        TokenKind::Word
    }
}

fn base_weight(token: &str, kind: TokenKind) -> f64 {
    match kind {
        // Dates and take numbers. They distinguish two renders of one song from each other, never one song from
        // another.
        TokenKind::Number => {
            if token.len() >= 3 {
                QUALIFIER_WEIGHT
            } else {
                0.25
            }
        }
        TokenKind::Qualifier => QUALIFIER_WEIGHT,
        TokenKind::Generic => GENERIC_WEIGHT,
        TokenKind::Word => {
            if token.chars().count() <= 2 {
                0.5
            } else {
                1.0
            }
        }
    }
}

/// `title` without a trailing known file extension.
fn without_extension(title: &str) -> &str {
    let Some(dot) = title.rfind('.') else {
        return title;
    };
    let extension = &title[dot + 1..];
    let known = KNOWN_EXTENSIONS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(extension));
    if known { &title[..dot] } else { title }
}

/// Lowercase, strip a known file extension, split letter/number boundaries and camelCase, and normalise to
/// whitespace-separated tokens. Apostrophes join their word ("it's" becomes "its"); every other punctuation mark
/// separates. Letters of any script are kept.
pub fn normalize_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len() + 4);
    let mut separate = false;
    let mut previous: Option<char> = None;
    for c in without_extension(title).chars() {
        if matches!(c, '\'' | '’' | '`') {
            continue;
        }
        if !c.is_alphanumeric() {
            separate = true;
            previous = Some(c);
            continue;
        }
        let boundary = previous.is_some_and(|p| {
            (p.is_lowercase() && c.is_uppercase())
                || (p.is_alphabetic() && c.is_ascii_digit())
                || (p.is_ascii_digit() && c.is_alphabetic())
        });
        if (separate || boundary) && !out.is_empty() {
            out.push(' ');
        }
        separate = false;
        out.extend(c.to_lowercase());
        previous = Some(c);
    }
    out
}

/// A run of adjacent tokens, joined into one word.
#[derive(Debug, Clone)]
struct Span {
    text: String,
    start: usize,
    length: usize,
}

/// The longest run of adjacent tokens considered as one word. Covers the titles people actually run together
/// ("im gonna be fine", "get around to it").
const MAX_SPAN: usize = 4;

/// A title with its normalisation, token sequence, weights and spans computed once.
#[derive(Debug, Clone)]
pub struct PreparedTitle {
    normalized: String,
    /// Tokens in the order they appear, duplicates kept: spans need adjacency.
    ordered: Vec<String>,
    weights: Vec<f64>,
    /// All tokens run together, so word boundaries stop mattering.
    joined: String,
    has_word: bool,
    spans: Vec<Span>,
}

impl PreparedTitle {
    /// Normalises `title` and tokenises it.
    pub fn new(title: &str) -> Self {
        let normalized = normalize_title(title);
        let ordered: Vec<String> = normalized.split_whitespace().map(str::to_owned).collect();
        let weights = ordered
            .iter()
            .map(|token| base_weight(token, token_kind(token)))
            .collect();
        let mut spans = Vec::new();
        for start in 0..ordered.len() {
            let mut text = String::new();
            for length in 1..=MAX_SPAN.min(ordered.len() - start) {
                text.push_str(&ordered[start + length - 1]);
                spans.push(Span {
                    text: text.clone(),
                    start,
                    length,
                });
            }
        }
        PreparedTitle {
            has_word: normalized.chars().any(char::is_alphabetic),
            joined: ordered.concat(),
            normalized,
            ordered,
            weights,
            spans,
        }
    }

    fn span_weight(&self, span: &Span) -> f64 {
        self.weights[span.start..span.start + span.length]
            .iter()
            .sum()
    }
}

/// How much of a name is about the material rather than about the bounce: the share of its token weight carried by
/// tokens that are neither qualifiers ("bounce", "final", "v") nor bare numbers. "master final 2" is 0; "canopy
/// master final" is about 0.77; "kick 808" is 0.7, because naming a part is still saying what the file is.
///
/// A name at 0 neither claims a song nor denies one, which is what lets the confidence model treat it as neutral
/// instead of as evidence against.
pub fn name_specificity(title: &PreparedTitle) -> f64 {
    let mut specific = 0.0;
    let mut total = 0.0;
    for (token, weight) in title.ordered.iter().zip(&title.weights) {
        total += weight;
        if !matches!(token_kind(token), TokenKind::Qualifier | TokenKind::Number) {
            specific += weight;
        }
    }
    if total == 0.0 { 0.0 } else { specific / total }
}

const MATCH_FLOOR: f64 = 0.78;
// A run of words matched as one word is credited for every token it covers, so it has to be near-exact: "im gonna
// be fine" for "imgonnabefine", not "ellison did" for "ellisone".
const SPAN_MATCH_FLOOR: f64 = 0.92;

/// Similarity of a shared prefix: stronger than the raw length ratio suggests ("tendrils" against "tendrils
/// prefin" is the same song), but only at three characters or more and a ratio of 0.6 or more.
fn prefix_similarity(t1: &str, t2: &str, shortest: usize, ratio: f64) -> Option<f64> {
    if (t1.starts_with(t2) || t2.starts_with(t1)) && shortest >= 3 {
        Some(if ratio >= 0.6 { 0.9 + 0.1 * ratio } else { 0.0 })
    } else {
        None
    }
}

/// Character counts of the shorter and the longer of two tokens.
fn lengths(t1: &str, t2: &str) -> (usize, usize) {
    let (a, b) = (t1.chars().count(), t2.chars().count());
    (a.min(b), a.max(b))
}

/// Similarity in `[0, 1]` between two token strings; 0 below the match floor.
fn token_similarity(t1: &str, t2: &str) -> f64 {
    if t1 == t2 {
        return 1.0;
    }
    if t1.is_empty() || t2.is_empty() {
        return 0.0;
    }
    let (shortest, longest) = lengths(t1, t2);
    let ratio = shortest as f64 / longest as f64;
    // Too different in length for any alignment to clear the floor.
    if ratio < 0.5 {
        return 0.0;
    }
    if let Some(similarity) = prefix_similarity(t1, t2, shortest, ratio) {
        return similarity;
    }
    let edit_ratio = normalized_levenshtein(t1, t2);
    let winkler = if shortest >= 4 {
        jaro_winkler(t1, t2) * 0.95
    } else {
        0.0
    };
    let best = edit_ratio.max(winkler);
    if best >= MATCH_FLOOR { best } else { 0.0 }
}

/// Similarity for a pair where at least one side is a run of words joined into one. Such a match is credited for
/// every token it covers, so it has to clear [`SPAN_MATCH_FLOOR`]: an exact match, a shared prefix or a
/// near-identical string.
fn span_similarity(t1: &str, t2: &str) -> f64 {
    if t1 == t2 {
        return 1.0;
    }
    let (shortest, longest) = lengths(t1, t2);
    let ratio = shortest as f64 / longest as f64;
    if let Some(similarity) = prefix_similarity(t1, t2, shortest, ratio) {
        return similarity;
    }
    // Below this, no alignment can reach the span floor.
    if ratio < SPAN_MATCH_FLOOR {
        return 0.0;
    }
    let edit_ratio = normalized_levenshtein(t1, t2);
    if edit_ratio >= SPAN_MATCH_FLOOR {
        edit_ratio
    } else {
        0.0
    }
}

/// Whether `token` is the initialism of the whole of `title`: "tafaycg" for "thats as far as you can go". Only a
/// whole-title initialism counts: allowing a partial run matches almost anything ("do" for "dancing on my own").
fn is_whole_title_initialism(token: &str, title: &PreparedTitle) -> bool {
    let letters: Vec<char> = token.chars().collect();
    let words = &title.ordered;
    if letters.len() < 3 || words.len() < 3 || words.len() != letters.len() {
        return false;
    }
    if !letters.iter().all(char::is_ascii_lowercase) {
        return false;
    }
    words
        .iter()
        .zip(&letters)
        .all(|(word, letter)| word.starts_with(*letter))
}

/// Two runs of tokens, one from each title, that match.
struct SpanPair {
    similarity: f64,
    a_start: usize,
    a_length: usize,
    a_weight: f64,
    b_start: usize,
    b_length: usize,
    b_weight: f64,
    has_word: bool,
}

fn span_pairs(a: &PreparedTitle, b: &PreparedTitle, total_a: f64, total_b: f64) -> Vec<SpanPair> {
    let mut pairs = Vec::new();
    for x in &a.spans {
        for y in &b.spans {
            // A run on both sides at once ("my song" vs "the song") adds nothing the per-token pairs do not
            // already cover, and squares the cost.
            if x.length > 1 && y.length > 1 {
                continue;
            }
            let similarity = if x.length + y.length > 2 {
                span_similarity(&x.text, &y.text)
            } else {
                token_similarity(&x.text, &y.text)
            };
            if similarity == 0.0 {
                continue;
            }
            pairs.push(SpanPair {
                similarity,
                a_start: x.start,
                a_length: x.length,
                a_weight: a.span_weight(x),
                b_start: y.start,
                b_length: y.length,
                b_weight: b.span_weight(y),
                has_word: x.text.chars().any(char::is_alphabetic)
                    || y.text.chars().any(char::is_alphabetic),
            });
        }
    }
    for x in &a.spans {
        if x.length == 1 && is_whole_title_initialism(&x.text, b) {
            pairs.push(SpanPair {
                similarity: 1.0,
                a_start: x.start,
                a_length: 1,
                a_weight: a.weights[x.start].max(1.0),
                b_start: 0,
                b_length: b.ordered.len(),
                b_weight: total_b,
                has_word: true,
            });
        }
    }
    for y in &b.spans {
        if y.length == 1 && is_whole_title_initialism(&y.text, a) {
            pairs.push(SpanPair {
                similarity: 1.0,
                a_start: 0,
                a_length: a.ordered.len(),
                a_weight: total_a,
                b_start: y.start,
                b_length: 1,
                b_weight: b.weights[y.start].max(1.0),
                has_word: true,
            });
        }
    }
    pairs
}

/// Similarity in `[0, 1]` between two prepared titles: a weighted Dice coefficient over a greedy bipartite match
/// of token spans, lifted by a containment score when one title sits whole inside the other. Tokens match across
/// word boundaries ("imgonnabefine" and "im gonna be fine"), by whole-title initialism ("tafaycg") and by edit
/// distance or Jaro-Winkler for typos.
///
/// A match carried only by numbers is rejected whenever either title has words in it, so `23.wav` never lands on
/// `Track 23`.
pub fn prepared_similarity(a: &PreparedTitle, b: &PreparedTitle) -> f64 {
    if a.normalized.is_empty() || b.normalized.is_empty() {
        return 0.0;
    }
    if a.normalized == b.normalized {
        return 1.0;
    }
    // Same words run together the same way: "itsNOTokay" and "itsnotokay".
    if a.joined == b.joined {
        return 1.0;
    }
    if a.ordered.is_empty() || b.ordered.is_empty() {
        return 0.0;
    }
    let total_a: f64 = a.weights.iter().sum();
    let total_b: f64 = b.weights.iter().sum();
    if total_a == 0.0 || total_b == 0.0 {
        return 0.0;
    }

    // Closest matches claim their tokens first, so an exact pair is never displaced by an approximate one that
    // happens to weigh more.
    let mut pairs = span_pairs(a, b, total_a, total_b);
    pairs.sort_by(|p1, p2| {
        p2.similarity
            .total_cmp(&p1.similarity)
            .then_with(|| (p2.a_weight + p2.b_weight).total_cmp(&(p1.a_weight + p1.b_weight)))
    });

    let mut used_a = vec![false; a.ordered.len()];
    let mut used_b = vec![false; b.ordered.len()];
    let mut matched_a = 0.0;
    let mut matched_b = 0.0;
    let mut match_count = 0;
    let mut last_similarity = 0.0;
    let mut has_word_match = false;
    for pair in &pairs {
        let a_range = pair.a_start..pair.a_start + pair.a_length;
        let b_range = pair.b_start..pair.b_start + pair.b_length;
        if used_a[a_range.clone()].iter().any(|used| *used)
            || used_b[b_range.clone()].iter().any(|used| *used)
        {
            continue;
        }
        used_a[a_range].fill(true);
        used_b[b_range].fill(true);
        matched_a += pair.similarity * pair.a_weight;
        matched_b += pair.similarity * pair.b_weight;
        match_count += 1;
        last_similarity = pair.similarity;
        has_word_match |= pair.has_word;
    }

    if match_count == 0 {
        return 0.0;
    }
    // If either title contains words, matching only numbers is not enough.
    if (a.has_word || b.has_word) && !has_word_match {
        return 0.0;
    }

    let dice = (matched_a + matched_b) / (total_a + total_b);

    // Containment: one title accounts for nearly all of the other, as a render named "ellisone fin2" does for the
    // set "ellisone". Scaled by how much of the longer title it covers, so a lone shared word inside a long
    // unrelated name cannot carry the match.
    //
    // A single fuzzy match is never enough ("ellisone" against "mara ellison - late bus home" would otherwise
    // qualify on the artist's name alone) and a single exact match has to cover more of the longer title than a
    // multi-word one does, since one shared word is far weaker evidence than three.
    let coverage_a = matched_a / total_a;
    let coverage_b = matched_b / total_b;
    let containment_allowed = match_count >= 2 || last_similarity >= 0.999;
    let base = if match_count >= 2 { 0.55 } else { 0.35 };
    let containment = if containment_allowed {
        coverage_a.max(coverage_b) * (base + (1.0 - base) * coverage_a.min(coverage_b))
    } else {
        0.0
    };

    dice.max(containment).clamp(0.0, 1.0)
}

/// Similarity in `[0, 1]` between two titles, file names or set names.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    prepared_similarity(&PreparedTitle::new(a), &PreparedTitle::new(b))
}

/// Every candidate of `candidates` at or above `threshold`, as its index and similarity, best first; of equals the
/// earlier comes first. Every candidate is scored: the best may sit anywhere in the list.
pub fn ranked_matches(title: &str, candidates: &[&str], threshold: f64) -> Vec<(usize, f64)> {
    let prepared = PreparedTitle::new(title);
    let mut found: Vec<(usize, f64)> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            (
                index,
                prepared_similarity(&prepared, &PreparedTitle::new(candidate)),
            )
        })
        .filter(|(_, score)| *score >= threshold)
        .collect();
    found.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    found
}

/// The best candidate of `candidates` at or above `threshold`, as its index and similarity; the first of equals
/// wins.
pub fn best_match(title: &str, candidates: &[&str], threshold: f64) -> Option<(usize, f64)> {
    ranked_matches(title, candidates, threshold)
        .into_iter()
        .next()
}

/// What identity a file's name gives it: a name with nothing song-specific in it is taken as neutral; any other
/// name is taken at its word, including when the word is another song's.
pub fn identity_of(name_score: f64, specificity: f64) -> f64 {
    if specificity < SPECIFIC_NAME {
        name_score.max(NEUTRAL_IDENTITY)
    } else {
        name_score
    }
}

/// Support counts in proportion to how plausible the identity already is: nothing below 0.25, fully from 0.5. So
/// "kick 808.wav" in a project folder stays near zero, "bounce 1.wav" in that project's own export folder reaches
/// 0.79, and "Canopy v3.wav" anywhere stands on its name.
pub fn confidence_of(identity: f64, support: f64) -> f64 {
    let gate = ((identity - GATE_FLOOR) / GATE_SPAN).clamp(0.0, 1.0);
    (identity + support * SUPPORT_LIFT * gate).min(1.0)
}

/// The save time nearest `mtime_ms`, as the file's time minus the save's (negative when the file is older). A zero
/// save time is no save time.
fn nearest_save_delta(mtime_ms: i64, save_times_ms: &[i64]) -> Option<i64> {
    save_times_ms
        .iter()
        .filter(|saved| **saved != 0)
        .map(|saved| mtime_ms.saturating_sub(*saved))
        .min_by_key(|delta| delta.unsigned_abs())
}

/// 1 at a save, 0.5 twelve hours from the nearest one, 0.06 two days out. Measured against the file's mtime, which
/// survives a copy where a birth time does not, and against every save time known for the set rather than only the
/// last: an old bounce is compared with the save it followed. 0 when no save time is known.
pub fn timing_of(mtime_ms: i64, save_times_ms: &[i64]) -> f64 {
    match nearest_save_delta(mtime_ms, save_times_ms) {
        Some(delta) => 0.5_f64.powf(delta.unsigned_abs() as f64 / TIMING_HALF_LIFE_MS as f64),
        None => 0.0,
    }
}

/// Where a file sits relative to the set it might be a bounce of.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Place {
    /// Somewhere that says nothing about the set.
    #[default]
    Elsewhere,
    /// In a folder the DAW names as where it exports to.
    ExportFolder,
    /// In the folder of the set's project, at its root.
    ProjectRoot,
    /// In a folder of the set's project, `depth` folders below its root.
    ProjectSubfolder { depth: u32 },
    /// In the folder of the set file, when the DAW makes no project folder.
    SetFolder,
}

impl Place {
    /// How much where a render sits says it came out of this set, in `[0, 1]`. A DAW that records where it
    /// exports to is taken at its word; otherwise a project folder speaks for its own subfolders, fading with
    /// depth, and a set without a project folder speaks only for the folder it sits in.
    pub fn locality(self) -> f64 {
        match self {
            Place::Elsewhere => 0.0,
            Place::ExportFolder => EXPORT_FOLDER_LOCALITY,
            Place::ProjectRoot => PROJECT_ROOT_LOCALITY,
            Place::ProjectSubfolder { depth } => {
                PROJECT_SUBFOLDER_LOCALITY
                    * SUBFOLDER_DEPTH_DECAY.powi(depth.saturating_sub(1) as i32)
            }
            Place::SetFolder => SET_FOLDER_LOCALITY,
        }
    }

    /// The reason a file's place counts for it, or `None` for [`Place::Elsewhere`].
    fn reason(self) -> Option<String> {
        match self {
            Place::Elsewhere => None,
            Place::ExportFolder => Some("In the folder the set exports to".to_owned()),
            Place::ProjectRoot => Some("In the set's project folder".to_owned()),
            Place::ProjectSubfolder { .. } => Some("In a folder of the set's project".to_owned()),
            Place::SetFolder => Some("Beside the set file".to_owned()),
        }
    }
}

/// A path's components, casefolded: the form two sources compare in, since a DAW records the case it was handed
/// and the filesystem may not agree.
fn folded(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

/// Where the file in `file_dir` sits relative to the set in `set_dir`. `project_folder` is the folder the set's
/// project lives in, when its DAW makes one; `export_dirs` are the folders the DAW names as its export folders.
pub fn place_of(
    file_dir: &Path,
    set_dir: &Path,
    project_folder: Option<&Path>,
    export_dirs: &[impl AsRef<Path>],
) -> Place {
    let file = folded(file_dir);
    if export_dirs.iter().any(|dir| folded(dir.as_ref()) == file) {
        return Place::ExportFolder;
    }
    match project_folder {
        Some(project) => {
            let project = folded(project);
            if !file.starts_with(&project) {
                return Place::Elsewhere;
            }
            match file.len() - project.len() {
                0 => Place::ProjectRoot,
                depth => Place::ProjectSubfolder {
                    depth: depth as u32,
                },
            }
        }
        None if folded(set_dir) == file => Place::SetFolder,
        None => Place::Elsewhere,
    }
}

/// The track's current version, which a later bounce of the track is likely to resemble.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Version<'a> {
    /// Its length in milliseconds.
    pub duration_ms: Option<u64>,
    /// Its container or codec, lowercase: `wav`, `mp3`, `flac`.
    pub format: Option<&'a str>,
}

/// Everything known about a file, beside its name, when it is scored.
#[derive(Debug, Clone, Copy, Default)]
pub struct Evidence<'a> {
    /// The file's name without its extension.
    pub file_stem: &'a str,
    /// The names the file might be called after: the track's title, the set's file name, the project folder. The
    /// closest one decides.
    pub names: &'a [&'a str],
    /// The file's mtime, in milliseconds.
    pub mtime_ms: i64,
    /// Every save time known for the set, in milliseconds.
    pub save_times_ms: &'a [i64],
    /// Where the file sits relative to the set.
    pub place: Place,
    /// The file's length, when it could be read.
    pub duration_ms: Option<u64>,
    /// The file's container or codec, lowercase: `wav`, `mp3`, `flac`.
    pub format: Option<&'a str>,
    /// The shortest length taken for a bounce; 0 for no floor. A name that says the song outright is exempt.
    pub min_render_ms: u64,
    /// The track's current version, when it has one.
    pub version: Option<Version<'a>>,
}

/// Which kinds of evidence speak for a file, as facts the panel words itself (the sentences in [`Score::reasons`] are
/// for logs and the cli).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonKinds {
    /// The name is like the name of the set's track ([`NAMES_A_TRACK`]).
    pub named: bool,
    /// The file sits where the set's renders belong (its project folder, beside the set, the DAW's export folder).
    pub in_folder: bool,
    /// The file was made near a save of the set: timing at least 0.5.
    pub near_save: bool,
}

/// How sure the model is that a file is a version of a track, with the reasons, as sentences for the panel.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Score {
    /// The confidence in `[0, 1]`.
    pub value: f64,
    /// Why, best evidence first; empty when nothing speaks for the file.
    pub reasons: Vec<String>,
    /// The file's time minus the time of the save nearest it, in milliseconds: positive when the file is the later.
    /// `None` when no save time is known.
    pub bounced_after_ms: Option<i64>,
    pub reason_kinds: ReasonKinds,
}

impl Score {
    /// Whether the confidence is enough to offer the file to the producer, who decides whether it is a version.
    pub fn is_offered(&self) -> bool {
        self.value >= ASK_CONFIDENCE
    }
}

/// How alike two lengths are: 1 when equal, falling to 0 when a fifth apart. 0 when either is unknown or zero.
fn length_closeness(a: Option<u64>, b: Option<u64>) -> f64 {
    let (Some(a), Some(b)) = (a, b) else {
        return 0.0;
    };
    if a == 0 || b == 0 {
        return 0.0;
    }
    let share = a.min(b) as f64 / a.max(b) as f64;
    ((share - LENGTH_CLOSE_SHARE) / (1.0 - LENGTH_CLOSE_SHARE)).clamp(0.0, 1.0)
}

/// A span of time, as the panel says it: "30 s", "2 min", "3 h", "2 days".
fn describe_span(ms: u64) -> String {
    const SECOND: u64 = 1_000;
    const MINUTE: u64 = 60 * SECOND;
    const HOUR: u64 = 60 * MINUTE;
    const DAY: u64 = 24 * HOUR;
    if ms < MINUTE {
        format!("{} s", (ms + SECOND / 2) / SECOND)
    } else if ms < 90 * MINUTE {
        format!("{} min", (ms + MINUTE / 2) / MINUTE)
    } else if ms < 36 * HOUR {
        format!("{} h", (ms + HOUR / 2) / HOUR)
    } else {
        format!("{} days", (ms + DAY / 2) / DAY)
    }
}

/// The reason timing counts, when the file was made within the half-life of a save.
fn timing_reason(delta_ms: i64) -> String {
    let span = delta_ms.unsigned_abs();
    if span < 60_000 {
        "Bounced within a minute of a save".to_owned()
    } else if delta_ms > 0 {
        format!("Bounced {} after a save", describe_span(span))
    } else {
        format!("Bounced {} before a save", describe_span(span))
    }
}

/// Scores a file against the names it might be called after and where and when it was made. Support (place,
/// timing, closeness to the current version) only counts once the name is plausible. Audio shorter than
/// `min_render_ms` is not taken for a bounce unless its name says the song outright: its value is 0.
pub fn score(evidence: &Evidence) -> Score {
    let file = PreparedTitle::new(evidence.file_stem);
    let mut name_score = 0.0;
    let mut closest: Option<&str> = None;
    for name in evidence.names {
        let similarity = prepared_similarity(&file, &PreparedTitle::new(name));
        if similarity > name_score {
            name_score = similarity;
            closest = Some(*name);
        }
    }
    let specificity = name_specificity(&file);
    let identity = identity_of(name_score, specificity);

    if let Some(duration) = evidence.duration_ms
        && duration > 0
        && duration < evidence.min_render_ms
        && identity < STRONG_IDENTITY
    {
        return Score {
            value: 0.0,
            reasons: vec![format!(
                "Shorter than {} and its name does not say the song",
                describe_span(evidence.min_render_ms)
            )],
            ..Score::default()
        };
    }

    let mut reasons = Vec::new();
    match closest {
        Some(name) if name_score >= NAMES_A_TRACK => {
            reasons.push(format!("Named like “{name}”"));
        }
        _ if specificity < SPECIFIC_NAME => reasons.push(
            "Its name says nothing about the song, so where and when it was made decide".to_owned(),
        ),
        _ => {}
    }

    let locality = evidence.place.locality();
    let save_delta = nearest_save_delta(evidence.mtime_ms, evidence.save_times_ms);
    let timing = timing_of(evidence.mtime_ms, evidence.save_times_ms);
    let mut closeness = 0.0;
    let mut same_format = false;
    if let Some(version) = evidence.version {
        closeness = length_closeness(evidence.duration_ms, version.duration_ms);
        same_format = version.format.is_some() && version.format == evidence.format;
    }
    let mut length_support = closeness * LENGTH_SUPPORT;
    if closeness > 0.0 && same_format {
        length_support += FORMAT_SUPPORT;
    }
    let support = locality.max(timing).max(length_support).min(1.0);
    let value = confidence_of(identity, support);

    let above_gate = identity > GATE_FLOOR;
    // Support is only a reason for a file whose name is plausible: below the gate it counts for nothing.
    if above_gate {
        if let Some(reason) = evidence.place.reason() {
            reasons.push(reason);
        }
        if let (Some(delta), true) = (save_delta, timing >= 0.5) {
            reasons.push(timing_reason(delta));
        }
        if closeness >= 0.5 {
            reasons.push("About as long as the track's current version".to_owned());
            if same_format {
                reasons.push("In the same format as the current version".to_owned());
            }
        }
    }

    let reason_kinds = ReasonKinds {
        named: above_gate && closest.is_some() && name_score >= NAMES_A_TRACK,
        in_folder: above_gate && evidence.place.reason().is_some(),
        near_save: above_gate && save_delta.is_some() && timing >= 0.5,
    };
    Score {
        value,
        reasons,
        bounced_after_ms: save_delta,
        reason_kinds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 60 * 1000;
    const HOUR: i64 = 60 * MINUTE;
    const DAY: i64 = 24 * HOUR;

    fn close(a: f64, b: f64, tolerance: f64) -> bool {
        (a - b).abs() < tolerance
    }

    fn at_least(a: &str, b: &str, floor: f64) {
        let similarity = title_similarity(a, b);
        assert!(
            similarity >= floor,
            "{a:?} against {b:?} scored {similarity}, wanted at least {floor}"
        );
    }

    fn below(a: &str, b: &str, ceiling: f64) {
        let similarity = title_similarity(a, b);
        assert!(
            similarity < ceiling,
            "{a:?} against {b:?} scored {similarity}, wanted under {ceiling}"
        );
    }

    #[test]
    fn normalizing_lowercases_strips_the_extension_and_collapses_punctuation() {
        assert_eq!(
            normalize_title("My Song (Final Mix).wav"),
            "my song final mix"
        );
        assert_eq!(normalize_title("MY-SONG!"), "my song");
        assert_eq!(normalize_title("no extension here"), "no extension here");
    }

    #[test]
    fn normalizing_splits_camel_case_and_alphanumeric_transitions() {
        assert_eq!(normalize_title("canopy1209.flac"), "canopy 1209");
        assert_eq!(normalize_title("SongV2Final"), "song v 2 final");
    }

    #[test]
    fn normalizing_strips_a_trailing_dot_segment_only_when_it_is_a_known_extension() {
        assert_eq!(normalize_title("01.Nerve.mp3"), "01 nerve");
        assert_eq!(normalize_title("Track.One.wav"), "track one");
        assert_eq!(normalize_title("Mr. Fahrenheit"), "mr fahrenheit");
        assert_eq!(normalize_title("19.84"), "19 84");
    }

    #[test]
    fn normalizing_keeps_letters_of_any_script() {
        assert_eq!(normalize_title("Café del Mar.wav"), "café del mar");
        assert_eq!(normalize_title("夜の街 mix"), "夜の街 mix");
    }

    #[test]
    fn a_numbered_mastered_export_matches_its_track_name() {
        at_least("01.Nerve.mp3", "Nerve", 0.6);
    }

    #[test]
    fn an_exact_match_is_one() {
        assert_eq!(title_similarity("My Song", "My Song"), 1.0);
    }

    #[test]
    fn a_parenthesized_suffix_variant_scores_above_the_threshold() {
        at_least("My Song", "My Song (Final Mix)", 0.6);
    }

    #[test]
    fn date_and_version_suffix_variants_score_above_the_threshold() {
        at_least("canopy 1209.flac", "canopy", 0.6);
        at_least("canopy1209.flac", "canopy", 0.6);
        at_least("canopy 1209.flac", "Canopy Project", 0.5);
        at_least("My Song", "My Song v2", 0.6);
    }

    #[test]
    fn single_word_containment_in_a_long_title_is_rejected() {
        below("ellisone", "mara ellison - late bus home.wav", 0.6);
        at_least("late bus home", "mara ellison - late bus home.wav", 0.7);
    }

    #[test]
    fn numeric_files_do_not_match_titles_with_letters() {
        assert_eq!(title_similarity("abacus banana 23", "2.wav"), 0.0);
        assert_eq!(title_similarity("abacus banana 23", "23.wav"), 0.0);
        assert_eq!(title_similarity("abacus banana 23", "2"), 0.0);
        assert_eq!(title_similarity("Track 23", "23.wav"), 0.0);
    }

    #[test]
    fn exact_numeric_matches_are_allowed() {
        assert_eq!(title_similarity("23", "23.wav"), 1.0);
        assert_eq!(title_similarity("1999", "1999.mp3"), 1.0);
    }

    #[test]
    fn titles_sharing_only_a_generic_word_score_below_the_threshold() {
        below("Other Song", "My Song", 0.6);
    }

    #[test]
    fn similarity_ignores_case_and_punctuation() {
        assert_eq!(title_similarity("MY-SONG!", "my song"), 1.0);
    }

    #[test]
    fn disjoint_titles_score_zero() {
        assert_eq!(title_similarity("Blue", "Red"), 0.0);
    }

    #[test]
    fn a_side_that_normalizes_to_nothing_scores_zero() {
        assert_eq!(title_similarity("", "My Song"), 0.0);
        assert_eq!(title_similarity("!!!", "My Song"), 0.0);
    }

    #[test]
    fn a_run_together_title_matches_its_spaced_form() {
        assert_eq!(
            title_similarity("imgonnabefine.wav", "Im Gonna Be Fine"),
            1.0
        );
        at_least("Im Gonna Be Fine Fin1.flac", "imgonnabefine", 0.6);
        at_least("holdontonow.mp3", "hold on to now!", 0.6);
        at_least("give me a break 1601.wav", "gimme a break", 0.6);
    }

    #[test]
    fn words_are_not_joined_to_reach_an_unrelated_title() {
        below("ellisone", "ellison late bus home", 0.6);
    }

    #[test]
    fn a_whole_title_initialism_matches() {
        at_least("tafaycg vocal demo.flac", "THATS AS FAR AS YOU CAN GO", 0.6);
        at_least("tlt 2803.flac", "the last time", 0.6);
    }

    #[test]
    fn an_initialism_of_only_part_of_a_title_is_ignored() {
        below("Robyn - Dancing On My Own.mp3", "do", 0.6);
    }

    #[test]
    fn version_date_and_format_qualifiers_are_looked_past() {
        assert!(title_similarity("ellisone fin2.flac", "ellisone") > 0.6);
        assert!(title_similarity("Tasmania Mix2 FINAL.flac", "Tasmania") > 0.6);
        assert!(title_similarity("Tendrils 240822.wav", "Tendrils (The Tower)") > 0.6);
    }

    #[test]
    fn two_songs_do_not_match_on_their_shared_qualifiers() {
        below("goofy goofy mix 1.mp3", "maccasmoon mix 1", 0.6);
        below("Calvin Harris - Outside (Official Video).mp3", "video", 0.6);
    }

    #[test]
    fn apostrophes_are_part_of_their_word() {
        at_least(
            "Mara Ellison - I Think It's Working Out.wav",
            "think its working out",
            0.6,
        );
    }

    #[test]
    fn the_best_of_several_candidates_wins() {
        let found = best_match(
            "My Song",
            &["Other Song", "My Song (Final Mix)", "Another Track"],
            0.6,
        );
        let (index, score) = found.expect("one candidate matches");
        assert_eq!(index, 1);
        assert!(score >= 0.6);
    }

    #[test]
    fn a_matching_multi_word_song_ranks_above_an_artist_name_fragment() {
        let (index, score) = best_match(
            "mara ellison - late bus home.wav",
            &["ellisone", "late bus home"],
            0.6,
        )
        .expect("one candidate matches");
        assert_eq!(index, 1);
        assert!(score >= 0.7);
    }

    #[test]
    fn a_candidate_under_the_threshold_is_not_a_match() {
        assert_eq!(best_match("Other Song", &["My Song"], 0.6), None);
        let (_, score) = best_match("Other Song", &["My Song"], 0.3).expect("clears 0.3");
        assert!(close(score, 0.38, 0.005), "scored {score}");
    }

    #[test]
    fn a_token_is_a_word_a_qualifier_a_generic_or_a_number() {
        assert_eq!(token_kind("canopy"), TokenKind::Word);
        assert_eq!(token_kind("final"), TokenKind::Qualifier);
        assert_eq!(token_kind("vocals"), TokenKind::Generic);
        assert_eq!(token_kind("1209"), TokenKind::Number);
    }

    fn specificity(title: &str) -> f64 {
        name_specificity(&PreparedTitle::new(title))
    }

    #[test]
    fn a_name_of_qualifiers_and_numbers_is_not_specific() {
        assert_eq!(specificity("master final 2.wav"), 0.0);
        assert_eq!(specificity("bounce 1.wav"), 0.0);
        assert_eq!(specificity("v3.wav"), 0.0);
    }

    #[test]
    fn a_name_carrying_a_song_word_is_specific() {
        assert!(close(specificity("canopy master final.wav"), 0.77, 0.005));
        assert_eq!(specificity("Canopies.wav"), 1.0);
    }

    #[test]
    fn a_word_naming_a_part_still_says_what_the_file_is() {
        assert!(close(specificity("kick 808.wav"), 0.7, 0.005));
        assert_eq!(specificity("vocals.wav"), 1.0);
    }

    #[test]
    fn a_name_with_no_tokens_is_not_specific() {
        assert_eq!(specificity(".wav"), 0.0);
    }

    /// The worked cases the model was designed against: what each file's name says, what its surroundings
    /// say, and what the two together decide.
    #[test]
    fn the_worked_cases_are_offered_as_designed() {
        let cases: [(&str, f64, f64, f64, bool); 8] = [
            ("kick 808.wav in the project root", 0.05, 0.85, 0.05, false),
            (
                "voice memo 3.m4a in a project subfolder",
                0.0,
                0.95,
                0.0,
                false,
            ),
            (
                "bounce 1.wav in the set's bounces folder",
                NEUTRAL_IDENTITY,
                0.95,
                0.785,
                true,
            ),
            (
                "master final.wav 20 min after a save",
                NEUTRAL_IDENTITY,
                0.98,
                0.794,
                true,
            ),
            (
                "master final.wav with no save within a week",
                NEUTRAL_IDENTITY,
                0.0,
                0.5,
                true,
            ),
            ("Canopy v3.wav in downloads", 0.92, 0.0, 0.92, true),
            ("Nerve mix.wav scored against Nerve", 0.9, 0.0, 0.9, true),
            ("Canopies.wav against Canopy", 0.6, 0.0, 0.6, true),
        ];
        for (case, identity, support, confidence, offered) in cases {
            let value = confidence_of(identity, support);
            assert!(close(value, confidence, 0.005), "{case}: {value}");
            let score = Score {
                value,
                ..Score::default()
            };
            assert_eq!(score.is_offered(), offered, "{case}");
        }
    }

    #[test]
    fn identity_reads_a_name_of_qualifiers_as_neutral_and_any_other_at_its_word() {
        let identity = |name: &str, name_score: f64| identity_of(name_score, specificity(name));
        assert_eq!(identity("bounce 1.wav", 0.0), NEUTRAL_IDENTITY);
        assert_eq!(identity("master final.wav", 0.0), NEUTRAL_IDENTITY);
        assert!(close(identity("kick 808.wav", 0.05), 0.05, 1e-5));
        assert_eq!(identity("voice memo 3.m4a", 0.0), 0.0);
        assert!(close(identity("Canopy v3.wav", 0.92), 0.92, 1e-5));
    }

    #[test]
    fn support_counts_for_nothing_under_an_identity_the_model_does_not_believe() {
        assert!(close(confidence_of(0.2, 1.0), 0.2, 1e-5));
        assert!(close(confidence_of(0.25, 1.0), 0.25, 1e-5));
    }

    #[test]
    fn support_fades_in_between_the_gate_and_a_plausible_identity() {
        assert!(close(confidence_of(0.375, 1.0), 0.375 + 0.15, 1e-5));
    }

    #[test]
    fn support_never_carries_a_file_past_one() {
        assert_eq!(confidence_of(0.95, 1.0), 1.0);
    }

    #[test]
    fn timing_halves_every_twelve_hours_from_the_nearest_save() {
        let saved = 100 * DAY;
        assert_eq!(timing_of(saved, &[saved]), 1.0);
        assert!(close(
            timing_of(saved + TIMING_HALF_LIFE_MS, &[saved]),
            0.5,
            1e-5
        ));
        assert!(close(timing_of(saved + 2 * DAY, &[saved]), 0.0625, 1e-3));
    }

    #[test]
    fn timing_is_measured_against_the_nearest_save_not_the_latest() {
        let saved = 100 * DAY;
        let backup = 40 * DAY;
        let near_backup = backup + HOUR;
        assert!(timing_of(near_backup, &[saved, backup]) > 0.9);
        assert!(timing_of(near_backup, &[saved]) < 0.01);
    }

    #[test]
    fn timing_scores_a_file_made_before_the_set_was_last_saved() {
        let saved = 100 * DAY;
        assert!(close(timing_of(saved - 20 * MINUTE, &[saved]), 0.98, 0.005));
    }

    #[test]
    fn timing_is_the_twenty_minutes_after_a_save() {
        let saved = 1000 * MINUTE;
        assert!(close(timing_of(saved + 20 * MINUTE, &[saved]), 0.98, 0.005));
    }

    #[test]
    fn timing_is_zero_with_no_save_time() {
        assert_eq!(timing_of(5 * DAY, &[]), 0.0);
        assert_eq!(timing_of(5 * DAY, &[0]), 0.0);
    }

    const PROJECT: &str = "/music/Canopy Project";

    fn place(dir: &str, project: Option<&str>, exports: &[&str]) -> Place {
        place_of(
            Path::new(dir),
            Path::new(project.unwrap_or("/music/loose")),
            project.map(Path::new),
            exports,
        )
    }

    #[test]
    fn a_folder_the_daw_names_as_its_export_folder_is_taken_at_its_word() {
        let found = place("/music/Exports", Some(PROJECT), &["/music/Exports"]);
        assert_eq!(found, Place::ExportFolder);
        assert_eq!(found.locality(), 1.0);
    }

    #[test]
    fn the_project_root_scores_below_its_subfolders() {
        let root = place(PROJECT, Some(PROJECT), &[]);
        assert_eq!(root, Place::ProjectRoot);
        assert_eq!(root.locality(), 0.85);
        let ideas = place("/music/Canopy Project/Ideas", Some(PROJECT), &[]);
        assert_eq!(ideas, Place::ProjectSubfolder { depth: 1 });
        assert_eq!(ideas.locality(), 0.95);
    }

    #[test]
    fn locality_fades_with_each_folder_deeper_in_the_project() {
        let deep = place(
            "/music/Canopy Project/Bounces/2024/March",
            Some(PROJECT),
            &[],
        );
        assert_eq!(deep, Place::ProjectSubfolder { depth: 3 });
        assert!(close(deep.locality(), 0.95 * 0.85 * 0.85, 1e-9));
    }

    #[test]
    fn a_folder_belonging_to_no_set_scores_nothing() {
        let found = place("/music/Bounces", Some(PROJECT), &[]);
        assert_eq!(found, Place::Elsewhere);
        assert_eq!(found.locality(), 0.0);
    }

    #[test]
    fn a_set_without_a_project_folder_speaks_only_for_its_own_folder() {
        let beside = place("/music/loose", None, &[]);
        assert_eq!(beside, Place::SetFolder);
        assert_eq!(beside.locality(), 0.7);
        assert_eq!(place("/music/elsewhere", None, &[]), Place::Elsewhere);
    }

    #[test]
    fn places_compare_without_regard_to_case() {
        assert_eq!(
            place("/Music/canopy project/bounces", Some(PROJECT), &[]),
            Place::ProjectSubfolder { depth: 1 }
        );
    }

    #[test]
    fn a_project_named_like_a_prefix_of_another_is_not_it() {
        assert_eq!(
            place("/music/Canopy Project 2", Some(PROJECT), &[]),
            Place::Elsewhere
        );
    }

    #[test]
    fn a_confidence_is_offered_from_the_ask_threshold() {
        let score = |value| Score {
            value,
            ..Score::default()
        };
        assert!(score(0.45).is_offered());
        assert!(score(0.99).is_offered());
        assert!(!score(0.4499).is_offered());
        assert!(!score(0.0).is_offered());
    }

    #[test]
    fn the_reason_kinds_are_facts_the_panel_words_and_the_delta_says_how_long_after_a_save() {
        let saved = 1_000_000_000_i64;
        let got = score(&Evidence {
            file_stem: "Canopy v3",
            names: &["Canopy"],
            place: Place::ProjectRoot,
            mtime_ms: saved + 7 * 60_000,
            save_times_ms: &[saved - 3 * 3_600_000, saved],
            ..Evidence::default()
        });
        assert_eq!(
            got.reason_kinds,
            ReasonKinds {
                named: true,
                in_folder: true,
                near_save: true
            }
        );
        assert_eq!(got.bounced_after_ms, Some(7 * 60_000));

        // Made before the nearest save: negative.
        let before = score(&Evidence {
            file_stem: "Canopy v3",
            names: &["Canopy"],
            mtime_ms: saved - 60_000,
            save_times_ms: &[saved],
            ..Evidence::default()
        });
        assert_eq!(before.bounced_after_ms, Some(-60_000));
        assert!(before.reason_kinds.near_save && !before.reason_kinds.in_folder);
    }

    #[test]
    fn a_kind_is_absent_when_its_evidence_is() {
        let far = score(&Evidence {
            file_stem: "master final",
            names: &["Canopy"],
            mtime_ms: 5 * 24 * 3_600_000,
            save_times_ms: &[1_000],
            ..Evidence::default()
        });
        assert_eq!(far.reason_kinds, ReasonKinds::default());
        assert_eq!(far.bounced_after_ms, Some(5 * 24 * 3_600_000 - 1_000));

        let none = score(&Evidence {
            file_stem: "master final",
            names: &["Canopy"],
            ..Evidence::default()
        });
        assert_eq!(none.bounced_after_ms, None);
        assert!(!none.reason_kinds.near_save);
    }

    #[test]
    fn a_generic_bounce_in_the_export_folder_just_after_a_save_is_offered() {
        let saved = 1000 * MINUTE;
        let got = score(&Evidence {
            file_stem: "bounce 1",
            names: &["Canopy"],
            mtime_ms: saved + 4 * MINUTE,
            save_times_ms: &[saved],
            place: Place::ExportFolder,
            ..Evidence::default()
        });
        assert!(got.value > 0.75, "scored {}", got.value);
        assert!(got.is_offered());
        assert_eq!(
            got.reasons,
            [
                "Its name says nothing about the song, so where and when it was made decide",
                "In the folder the set exports to",
                "Bounced 4 min after a save",
            ]
        );
    }

    #[test]
    fn a_name_that_says_the_song_stands_on_its_own() {
        let got = score(&Evidence {
            file_stem: "Canopy v3",
            names: &["Nerve", "Canopy"],
            ..Evidence::default()
        });
        assert!(got.value >= NAMES_A_TRACK, "scored {}", got.value);
        assert_eq!(got.reasons, ["Named like “Canopy”"]);
    }

    #[test]
    fn a_sample_in_the_project_folder_stays_where_its_name_puts_it() {
        let got = score(&Evidence {
            file_stem: "kick 808",
            names: &["Canopy"],
            place: Place::ProjectRoot,
            ..Evidence::default()
        });
        assert!(got.value < ASK_CONFIDENCE, "scored {}", got.value);
        assert!(!got.is_offered());
        assert!(got.reasons.is_empty(), "{:?}", got.reasons);
    }

    #[test]
    fn a_generic_bounce_with_no_support_is_asked_about() {
        let got = score(&Evidence {
            file_stem: "master final",
            names: &["Canopy"],
            ..Evidence::default()
        });
        assert!(close(got.value, 0.5, 1e-9));
        assert!(got.is_offered());
    }

    #[test]
    fn audio_shorter_than_the_floor_is_not_a_bounce_unless_the_name_says_the_song() {
        let short = |stem: &'static str| Evidence {
            file_stem: stem,
            names: &["Canopy"],
            place: Place::ExportFolder,
            duration_ms: Some(8_000),
            min_render_ms: MIN_RENDER_MS,
            ..Evidence::default()
        };
        let generic = score(&short("bounce 1"));
        assert_eq!(generic.value, 0.0);
        assert_eq!(
            generic.reasons,
            ["Shorter than 30 s and its name does not say the song"]
        );
        let named = score(&short("Canopy intro"));
        assert!(named.value > 0.0, "a name that says the song keeps it in");
    }

    #[test]
    fn an_unknown_length_is_never_too_short() {
        let got = score(&Evidence {
            file_stem: "bounce 1",
            names: &["Canopy"],
            place: Place::ExportFolder,
            duration_ms: None,
            min_render_ms: MIN_RENDER_MS,
            ..Evidence::default()
        });
        assert!(got.value > 0.0);
    }

    #[test]
    fn a_bounce_as_long_as_the_current_version_is_supported_by_it() {
        let evidence = |duration_ms| Evidence {
            file_stem: "master final",
            names: &["Canopy"],
            duration_ms: Some(duration_ms),
            version: Some(Version {
                duration_ms: Some(200_000),
                format: Some("wav"),
            }),
            ..Evidence::default()
        };
        let close_length = score(&evidence(201_000));
        assert!(close_length.value > 0.5, "scored {}", close_length.value);
        assert!(
            close_length
                .reasons
                .contains(&"About as long as the track's current version".to_owned())
        );
        let far_length = score(&evidence(60_000));
        assert!(
            close(far_length.value, 0.5, 1e-9),
            "scored {}",
            far_length.value
        );
    }

    #[test]
    fn support_is_not_a_reason_when_the_name_is_too_far_off_for_it_to_count() {
        let got = score(&Evidence {
            file_stem: "voice memo",
            names: &["Canopy"],
            place: Place::ExportFolder,
            mtime_ms: 100_000,
            save_times_ms: &[99_000],
            ..Evidence::default()
        });
        assert!(got.value < ASK_CONFIDENCE);
        assert!(got.reasons.is_empty(), "{:?}", got.reasons);
        assert!(!got.reason_kinds.named);
        assert!(!got.reason_kinds.in_folder);
        assert!(!got.reason_kinds.near_save);
    }

    #[test]
    fn spans_of_time_read_as_the_panel_says_them() {
        assert_eq!(describe_span(30_000), "30 s");
        assert_eq!(describe_span(4 * MINUTE as u64), "4 min");
        assert_eq!(describe_span(3 * HOUR as u64), "3 h");
        assert_eq!(describe_span(2 * DAY as u64), "2 days");
    }

    #[test]
    fn a_file_older_than_the_save_says_before() {
        assert_eq!(timing_reason(-3 * MINUTE), "Bounced 3 min before a save");
        assert_eq!(timing_reason(30_000), "Bounced within a minute of a save");
    }
}
