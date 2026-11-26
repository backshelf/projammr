//! The rules that decide which audio files are worth proposing as renders, and how they group: what counts as audio,
//! which paths are never offered, which files are one bounce in several formats, which are an export of stems, and
//! how long a file is held before it is proposed. Pure: the caller passes the files and the times, in milliseconds.
//!
//! The exclusions are the built-in denylist, the DAW-managed folders and the audio extensions; the denylist matches
//! names, and only below the folder a scan was pointed at. The preference between the formats of one bounce is
//! `preferredFirst` of `packages/media/src/bounce.ts`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::score::normalize_title;

/// How long a file must have stayed stable before it is proposed, counted from the moment it became stable.
pub const HOLD_MS: i64 = 60_000;

/// Audio files whose times chain within this of each other, three or more at once, are an export of stems.
pub const BATCH_WINDOW_MS: i64 = 60_000;

/// How many renders written within [`BATCH_WINDOW_MS`] of one another make a batch.
pub const BATCH_MIN: usize = 3;

/// The extensions of the files that are audio, lowercase and without the dot.
pub const AUDIO_EXTENSIONS: [&str; 8] = ["wav", "mp3", "aiff", "aif", "flac", "m4a", "aac", "ogg"];

/// The formats that keep every sample of the audio they were exported from.
const LOSSLESS_EXTENSIONS: [&str; 4] = ["wav", "aiff", "aif", "flac"];

/// Whether `extension` (without the dot, any case) is an audio extension.
pub fn is_audio_ext(extension: &str) -> bool {
    AUDIO_EXTENSIONS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(extension))
}

/// Whether `path` names an audio file, by its extension alone.
pub fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(is_audio_ext)
}

fn is_lossless_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            LOSSLESS_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
}

/// Whether a file or folder name is one of a stem export: `Stems`, `stemz`, `Drums (Stems)`, `Bass Stem`,
/// `stem_01`, `BassStem`. It is a match when a word of the name, split as titles are (on punctuation, camelCase and
/// letter/number boundaries), is `stem`, `stems` or `stemz`. A word merely containing one (`system`, `stemmed`) is
/// not. The extension of an audio file is not part of the name.
pub fn is_stem_name(name: &str) -> bool {
    normalize_title(name)
        .split_whitespace()
        .any(|word| matches!(word, "stem" | "stems" | "stemz"))
}

/// Folders and files nothing is offered from, by exact name (casefolded): version control, OS and sync-client
/// folders, the macOS `Library` and its `Application Support`, trash, and the folders Live keeps its own working
/// files and its library in. Names starting with a dot are excluded as a class ([`is_excluded_name`]), which covers
/// `.git`, `.Trash`, `.DS_Store`, `.Spotlight-V100`, `.fseventsd` and the Dropbox folders.
pub const EXCLUDED_NAMES: [&str; 10] = [
    "node_modules",
    "library",
    "application support",
    "trash",
    "backup",
    "samples",
    "freeze",
    "recorded",
    "ableton project info",
    "ableton",
];

/// Whether a single path component is excluded on its own, whatever its folder: a dot name, a sync placeholder or
/// temporary file (`*.icloud`, `*.dropbox`, `*.tmp`, `*.~tmp`, `~*`), one of [`EXCLUDED_NAMES`], or a stem name.
pub fn is_excluded_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || lower.starts_with('~')
        || [".icloud", ".dropbox", ".tmp", ".~tmp"]
            .iter()
            .any(|suffix| lower.ends_with(suffix))
        || EXCLUDED_NAMES.contains(&lower.as_str())
        || is_stem_name(name)
}

/// A path's components, casefolded: the form two sources compare in, since a DAW records the case it was handed and
/// the filesystem may not agree.
fn folded(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

/// Whether `path` is `folder` or inside it, comparing components without regard to case.
pub fn is_under(path: &Path, folder: &Path) -> bool {
    folded(path).starts_with(&folded(folder))
}

/// The paths nothing is offered from: the built-in names ([`is_excluded_name`]), the DAW's managed subfolders and
/// the folders the producer said "Never here" to.
#[derive(Debug, Clone, Default)]
pub struct Exclusions {
    managed: Vec<String>,
    never_here: Vec<Vec<String>>,
    excluded: Vec<Vec<String>>,
    roots: Vec<PathBuf>,
}

impl Exclusions {
    /// `managed` are the names of the subfolders a DAW owns inside a project (`Daw::managed_subfolders`);
    /// `never_here` are folders whose whole tree is excluded.
    pub fn new(managed: &[&str], never_here: &[PathBuf]) -> Self {
        Exclusions {
            managed: managed.iter().map(|name| name.to_lowercase()).collect(),
            never_here: never_here.iter().map(|folder| folded(folder)).collect(),
            ..Exclusions::default()
        }
    }

    fn component_excluded(&self, name: &str) -> bool {
        is_excluded_name(name) || self.managed.contains(&name.to_lowercase())
    }

    /// Whether `path` is excluded: it is inside a "never here" folder, or any component of it, its own name
    /// included, is excluded by name.
    pub fn excludes(&self, path: &Path) -> bool {
        self.never_here_holds(path) || self.excludes_names(path.components())
    }

    /// Like [`Exclusions::excludes`] for a path reached from a watched `root`: the names of `root` itself and of
    /// everything above it are the producer's choice, so a root inside a folder called `Library` still counts. The
    /// "never here" folders apply wherever they are. A path not under `root` is checked whole.
    pub fn excludes_below(&self, root: &Path, path: &Path) -> bool {
        if self.never_here_holds(path) {
            return true;
        }
        let skip = if is_under(path, root) {
            root.components().count()
        } else {
            0
        };
        self.excludes_names(path.components().skip(skip))
    }

    /// Replaces the "never here" folders.
    pub fn set_never_here(&mut self, never_here: &[PathBuf]) {
        self.never_here = never_here.iter().map(|folder| folded(folder)).collect();
    }

    /// Replaces the folders the producer excluded in the settings; like "never here", their whole tree is out.
    pub fn set_excluded(&mut self, excluded: &[PathBuf]) {
        self.excluded = excluded.iter().map(|folder| folded(folder)).collect();
    }

    /// Replaces the watched roots, which [`Exclusions::excludes_watched`] measures names from.
    pub fn set_roots(&mut self, roots: &[PathBuf]) {
        self.roots = roots.to_vec();
    }

    /// Whether a path heard under the watched roots is excluded: measured from the deepest root that holds it, so a
    /// root inside a folder called `Library` still counts; a path under no root is out. With no roots set, `fallback`
    /// is the one root.
    pub fn excludes_watched(&self, fallback: &Path, path: &Path) -> bool {
        if self.roots.is_empty() {
            return self.excludes_below(fallback, path);
        }
        match self
            .roots
            .iter()
            .filter(|root| is_under(path, root))
            .max_by_key(|root| root.components().count())
        {
            Some(root) => self.excludes_below(root, path),
            None => true,
        }
    }

    fn never_here_holds(&self, path: &Path) -> bool {
        let path = folded(path);
        self.never_here
            .iter()
            .chain(&self.excluded)
            .any(|folder| path.starts_with(folder))
    }

    fn excludes_names<'a>(
        &self,
        mut components: impl Iterator<Item = std::path::Component<'a>>,
    ) -> bool {
        components.any(|component| match component {
            std::path::Component::Normal(name) => self.component_excluded(&name.to_string_lossy()),
            _ => false,
        })
    }
}

/// Whether `path` is excluded, given the DAW's managed subfolders and the "never here" folders. See
/// [`Exclusions`] to ask of many paths.
pub fn excluded(path: &Path, managed: &[&str], never_here: &[PathBuf]) -> bool {
    Exclusions::new(managed, never_here).excludes(path)
}

/// An audio file found on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub path: PathBuf,
    /// Its size in bytes.
    pub size: u64,
    /// Its modification time in milliseconds since the epoch.
    pub mtime_ms: i64,
}

/// One bounce: the files of one folder with the same name and different audio extensions (`Mix.wav`, `Mix.mp3`),
/// which are the formats one export wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Render {
    /// The stem the files share, as the first of them (by path) spells it.
    pub name: String,
    /// The files, ordered by path.
    pub files: Vec<Candidate>,
}

impl Render {
    /// When the render was finished: the newest modification time of its files, or 0 for none.
    pub fn mtime_ms(&self) -> i64 {
        self.files
            .iter()
            .map(|file| file.mtime_ms)
            .max()
            .unwrap_or(0)
    }
}

/// Groups audio candidates into renders: same folder, same stem without regard to case. Candidates that are not
/// audio files are left out. Renders come back ordered by folder then name, so the same files always group and order
/// the same way.
pub fn group_pairs(files: &[Candidate]) -> Vec<Render> {
    let mut audio: Vec<&Candidate> = files
        .iter()
        .filter(|file| is_audio_path(&file.path))
        .collect();
    audio.sort_by(|a, b| a.path.cmp(&b.path));

    let mut renders: BTreeMap<(PathBuf, String), Render> = BTreeMap::new();
    for file in audio {
        let folder = file
            .path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        let stem = file
            .path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        renders
            .entry((folder, stem.to_lowercase()))
            .or_insert_with(|| Render {
                name: stem,
                files: Vec::new(),
            })
            .files
            .push(file.clone());
    }
    renders.into_values().collect()
}

/// Which file of a render goes up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Choice {
    /// The file at this index of [`Render::files`].
    Upload(usize),
    /// No file fits the size limit.
    OverLimit,
}

const BYTES_PER_MB: u64 = 1024 * 1024;

/// The file of `render` to upload: the largest that fits `max_upload_mb` (0 for no limit), a tie going to a
/// lossless format and then to the path that sorts first. A file fits when it is no larger than the limit.
/// [`Choice::OverLimit`] when none fits.
pub fn upload_choice(render: &Render, max_upload_mb: u64) -> Choice {
    let limit = (max_upload_mb != 0).then(|| max_upload_mb.saturating_mul(BYTES_PER_MB));
    render
        .files
        .iter()
        .enumerate()
        .filter(|(_, file)| limit.is_none_or(|limit| file.size <= limit))
        .min_by(|(_, a), (_, b)| {
            b.size
                .cmp(&a.size)
                .then_with(|| is_lossless_path(&b.path).cmp(&is_lossless_path(&a.path)))
                .then_with(|| a.path.cmp(&b.path))
        })
        .map_or(Choice::OverLimit, |(index, _)| Choice::Upload(index))
}

/// The batches among `renders`: runs of [`BATCH_MIN`] or more renders written within [`BATCH_WINDOW_MS`] of the
/// one before, by each render's [`Render::mtime_ms`]. An export of stems writes its files one after another, so
/// they chain however long the export takes. Each batch lists indices into `renders` in ascending order; batches
/// come ordered by their earliest render. A render is in at most one batch.
pub fn batches(renders: &[Render]) -> Vec<Vec<usize>> {
    let mut by_time: Vec<(i64, usize)> = renders
        .iter()
        .enumerate()
        .map(|(index, render)| (render.mtime_ms(), index))
        .collect();
    by_time.sort();

    let mut found = Vec::new();
    let mut run: Vec<(i64, usize)> = Vec::new();
    for entry in by_time {
        if let Some((last, _)) = run.last()
            && entry.0 - last > BATCH_WINDOW_MS
        {
            close_run(&mut run, &mut found);
        }
        run.push(entry);
    }
    close_run(&mut run, &mut found);
    found
}

/// Moves `run` to `found`, as ascending indices, when it is long enough to be a batch.
fn close_run(run: &mut Vec<(i64, usize)>, found: &mut Vec<Vec<usize>>) {
    if run.len() >= BATCH_MIN {
        let mut indices: Vec<usize> = run.iter().map(|(_, index)| *index).collect();
        indices.sort_unstable();
        found.push(indices);
    }
    run.clear();
}

/// Whether a file that last became stable at `last_stable_ms` has been held long enough at `now_ms` to be proposed.
/// A clock that went backwards holds nothing back: the answer is no until it catches up.
pub fn due_after_hold(last_stable_ms: i64, now_ms: i64) -> bool {
    now_ms.saturating_sub(last_stable_ms) >= HOLD_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64, mtime_ms: i64) -> Candidate {
        Candidate {
            path: PathBuf::from(path),
            size,
            mtime_ms,
        }
    }

    fn render(files: Vec<Candidate>) -> Render {
        let name = files[0]
            .path
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Render { name, files }
    }

    #[test]
    fn audio_extensions_are_recognised_in_any_case() {
        for extension in ["wav", "MP3", "Aiff", "aif", "flac", "m4a", "aac", "ogg"] {
            assert!(is_audio_ext(extension), "{extension}");
        }
        for extension in ["als", "txt", "", "wave", "mid", "alp"] {
            assert!(!is_audio_ext(extension), "{extension}");
        }
    }

    #[test]
    fn a_path_is_audio_by_its_extension_alone() {
        assert!(is_audio_path(Path::new("/m/Mix.WAV")));
        assert!(is_audio_path(Path::new("/m/Mix.v2.flac")));
        assert!(!is_audio_path(Path::new("/m/Mix")));
        assert!(!is_audio_path(Path::new("/m/Mix.als")));
        assert!(!is_audio_path(Path::new("/m/wav")));
    }

    #[test]
    fn stem_names_are_matched_by_word() {
        for name in [
            "Bass Stem",
            "Drums (Stems)",
            "stem_01",
            "Stems",
            "stemz",
            "STEMS",
            "BassStem",
            "stem01.wav",
            "Song - Vocal Stem.wav",
        ] {
            assert!(is_stem_name(name), "{name}");
        }
        for name in [
            "System",
            "Mix",
            "stemmed",
            "Bounces",
            "Hystem",
            "Canopy v3.wav",
            "",
        ] {
            assert!(!is_stem_name(name), "{name}");
        }
    }

    #[test]
    fn built_in_names_are_excluded_in_any_case() {
        for name in [
            "Backup",
            "SAMPLES",
            "freeze",
            "Recorded",
            "Ableton",
            "Ableton Project Info",
            "Library",
            "Application Support",
            "Trash",
            "node_modules",
            ".git",
            ".DS_Store",
            ".Trash",
            ".hidden",
            "._Mix.wav",
            "Mix.icloud",
            "x.dropbox",
            "x.tmp",
            "x.~tmp",
            "~$lock",
            "Stems",
        ] {
            assert!(is_excluded_name(name), "{name}");
        }
        for name in [
            "Bounces",
            "Mix.wav",
            "Canopy Project",
            "Samples.wav",
            "Backups",
            "tmp",
        ] {
            assert!(!is_excluded_name(name), "{name}");
        }
    }

    #[test]
    fn a_path_is_excluded_when_any_component_is() {
        let none: [PathBuf; 0] = [];
        assert!(excluded(
            Path::new("/m/Canopy Project/Backup/Mix.wav"),
            &[],
            &none
        ));
        assert!(excluded(Path::new("/Users/p/Library/Mix.wav"), &[], &none));
        assert!(excluded(
            Path::new("/m/Canopy Project/Stems/vox.wav"),
            &[],
            &none
        ));
        assert!(excluded(
            Path::new("/m/Canopy Project/Bass Stem.wav"),
            &[],
            &none
        ));
        assert!(excluded(Path::new("/m/.hidden/Mix.wav"), &[], &none));
        assert!(!excluded(
            Path::new("/m/Canopy Project/Bounces/Mix.wav"),
            &[],
            &none
        ));
        assert!(!excluded(
            Path::new("/m/Canopy Project/Mix.wav"),
            &[],
            &none
        ));
    }

    #[test]
    fn the_daws_managed_subfolders_are_excluded() {
        let none: [PathBuf; 0] = [];
        let path = Path::new("/m/Canopy Project/Printed Tracks/Mix.wav");
        assert!(!excluded(path, &[], &none));
        assert!(excluded(path, &["Printed Tracks"], &none));
        assert!(excluded(path, &["printed tracks"], &none));
        assert!(!excluded(
            Path::new("/m/Canopy Project/Mix.wav"),
            &["Printed Tracks"],
            &none
        ));
    }

    #[test]
    fn a_never_here_folder_excludes_its_whole_tree_and_nothing_beside_it() {
        let never = [PathBuf::from("/m/Canopy Project/Bounces")];
        assert!(excluded(
            Path::new("/m/Canopy Project/Bounces/Mix.wav"),
            &[],
            &never
        ));
        assert!(excluded(
            Path::new("/m/canopy project/bounces/deep/Mix.wav"),
            &[],
            &never
        ));
        assert!(excluded(
            Path::new("/m/Canopy Project/Bounces"),
            &[],
            &never
        ));
        assert!(!excluded(
            Path::new("/m/Canopy Project/Mix.wav"),
            &[],
            &never
        ));
        assert!(!excluded(
            Path::new("/m/Canopy Project/Bounces 2/Mix.wav"),
            &[],
            &never
        ));
    }

    #[test]
    fn names_at_and_above_the_watched_root_are_the_producers_choice() {
        let exclusions = Exclusions::new(&[], &[]);
        let root = Path::new("/Users/p/Library/Mobile Documents");
        let inside = Path::new("/Users/p/Library/Mobile Documents/Canopy Project/Mix.wav");
        assert!(exclusions.excludes(inside));
        assert!(!exclusions.excludes_below(root, inside));
        assert!(exclusions.excludes_below(
            root,
            Path::new("/Users/p/Library/Mobile Documents/Canopy Project/Backup/Mix.wav")
        ));
        assert!(!exclusions.excludes_below(Path::new("/USERS/P/LIBRARY/Mobile Documents"), inside));
        assert!(exclusions.excludes_below(root, Path::new("/Users/p/Library/Mix.wav")));
    }

    #[test]
    fn never_here_applies_below_a_root_too() {
        let exclusions = Exclusions::new(&[], &[PathBuf::from("/m/Bounces")]);
        assert!(exclusions.excludes_below(Path::new("/m"), Path::new("/m/Bounces/Mix.wav")));
        assert!(!exclusions.excludes_below(Path::new("/m"), Path::new("/m/Other/Mix.wav")));
    }

    #[test]
    fn watched_roots_decide_what_is_heard_and_names_are_measured_from_the_deepest_root() {
        let mut exclusions = Exclusions::new(&["Backup"], &[]);
        exclusions.set_roots(&[
            PathBuf::from("/Users/p/Music"),
            PathBuf::from("/Volumes/Beats/Library"),
        ]);
        let fallback = Path::new("/Users/p");

        assert!(!exclusions.excludes_watched(fallback, Path::new("/Users/p/Music/Mix.wav")));
        // The root itself is called Library; only what is below it counts.
        assert!(
            !exclusions.excludes_watched(fallback, Path::new("/Volumes/Beats/Library/Mix.wav"))
        );
        assert!(
            exclusions
                .excludes_watched(fallback, Path::new("/Volumes/Beats/Library/Backup/Mix.wav"))
        );
        assert!(exclusions.excludes_watched(fallback, Path::new("/Users/p/Music/Library/Mix.wav")));
        // Outside every root: not heard.
        assert!(exclusions.excludes_watched(fallback, Path::new("/Users/p/Downloads/Mix.wav")));

        exclusions.set_roots(&[]);
        assert!(!exclusions.excludes_watched(fallback, Path::new("/Users/p/Downloads/Mix.wav")));
    }

    #[test]
    fn folders_excluded_in_the_settings_are_out_whole_and_replaceable_apart_from_never_here() {
        let mut exclusions = Exclusions::new(&[], &[PathBuf::from("/m/Never")]);
        exclusions.set_excluded(&[PathBuf::from("/m/Old Mixes")]);
        let root = Path::new("/m");

        assert!(exclusions.excludes_below(root, Path::new("/m/Old Mixes/2019/Mix.wav")));
        assert!(exclusions.excludes_below(root, Path::new("/m/Never/Mix.wav")));
        assert!(!exclusions.excludes_below(root, Path::new("/m/New/Mix.wav")));

        exclusions.set_excluded(&[]);
        assert!(!exclusions.excludes_below(root, Path::new("/m/Old Mixes/Mix.wav")));
        assert!(exclusions.excludes_below(root, Path::new("/m/Never/Mix.wav")));
        exclusions.set_never_here(&[]);
        assert!(!exclusions.excludes_below(root, Path::new("/m/Never/Mix.wav")));
    }

    #[test]
    fn is_under_compares_whole_components() {
        assert!(is_under(
            Path::new("/m/Bounces/Mix.wav"),
            Path::new("/m/bounces")
        ));
        assert!(is_under(Path::new("/m/Bounces"), Path::new("/m/Bounces")));
        assert!(!is_under(
            Path::new("/m/Bounces 2/Mix.wav"),
            Path::new("/m/Bounces")
        ));
    }

    #[test]
    fn the_formats_of_one_bounce_are_one_render() {
        let files = [
            file("/m/Mix.mp3", 3_000, 10),
            file("/m/Mix.wav", 30_000, 10),
            file("/m/Other.wav", 10_000, 10),
        ];
        let renders = group_pairs(&files);
        assert_eq!(renders.len(), 2);
        assert_eq!(renders[0].name, "Mix");
        assert_eq!(
            renders[0].files,
            [
                file("/m/Mix.mp3", 3_000, 10),
                file("/m/Mix.wav", 30_000, 10)
            ]
        );
        assert_eq!(renders[1].name, "Other");
        assert_eq!(renders[1].files.len(), 1);
    }

    #[test]
    fn pairs_match_without_regard_to_case_but_only_within_a_folder() {
        let files = [
            file("/m/Mix.wav", 1, 0),
            file("/m/MIX.MP3", 1, 0),
            file("/n/Mix.wav", 1, 0),
        ];
        let renders = group_pairs(&files);
        assert_eq!(renders.len(), 2);
        assert_eq!(renders[0].files.len(), 2);
        assert_eq!(
            renders[0].name, "MIX",
            "named as the first by path spells it"
        );
        assert_eq!(renders[1].files.len(), 1);
        assert_eq!(renders[1].files[0].path, Path::new("/n/Mix.wav"));
    }

    #[test]
    fn a_stem_with_dots_pairs_on_everything_before_the_last_extension() {
        let files = [file("/m/Mix.v2.wav", 1, 0), file("/m/Mix.v2.flac", 1, 0)];
        let renders = group_pairs(&files);
        assert_eq!(renders.len(), 1);
        assert_eq!(renders[0].name, "Mix.v2");
    }

    #[test]
    fn candidates_that_are_not_audio_are_left_out() {
        let files = [file("/m/Mix.als", 1, 0), file("/m/notes.txt", 1, 0)];
        assert!(group_pairs(&files).is_empty());
    }

    #[test]
    fn grouping_does_not_depend_on_the_order_it_is_given() {
        let a = [
            file("/m/B.wav", 1, 0),
            file("/m/A.mp3", 1, 0),
            file("/m/A.wav", 1, 0),
        ];
        let b = [
            file("/m/A.wav", 1, 0),
            file("/m/B.wav", 1, 0),
            file("/m/A.mp3", 1, 0),
        ];
        assert_eq!(group_pairs(&a), group_pairs(&b));
    }

    #[test]
    fn the_largest_file_under_the_limit_goes_up() {
        const MB: u64 = 1024 * 1024;
        let pair = render(vec![
            file("/m/Mix.mp3", 8 * MB, 0),
            file("/m/Mix.wav", 40 * MB, 0),
        ]);
        assert_eq!(upload_choice(&pair, 0), Choice::Upload(1), "no limit");
        assert_eq!(upload_choice(&pair, 100), Choice::Upload(1));
        assert_eq!(
            upload_choice(&pair, 10),
            Choice::Upload(0),
            "the wav is over"
        );
    }

    #[test]
    fn a_file_exactly_at_the_limit_fits() {
        const MB: u64 = 1024 * 1024;
        let at = render(vec![file("/m/Mix.wav", 10 * MB, 0)]);
        assert_eq!(upload_choice(&at, 10), Choice::Upload(0));
        let over = render(vec![file("/m/Mix.wav", 10 * MB + 1, 0)]);
        assert_eq!(upload_choice(&over, 10), Choice::OverLimit);
    }

    #[test]
    fn a_render_none_of_whose_files_fit_is_over_the_limit() {
        const MB: u64 = 1024 * 1024;
        let pair = render(vec![
            file("/m/Mix.mp3", 8 * MB, 0),
            file("/m/Mix.wav", 40 * MB, 0),
        ]);
        assert_eq!(upload_choice(&pair, 5), Choice::OverLimit);
        assert_eq!(upload_choice(&pair, 1), Choice::OverLimit);
    }

    #[test]
    fn a_size_tie_goes_to_lossless_and_then_to_the_path_that_sorts_first() {
        let lossy_first = render(vec![
            file("/m/Mix.aac", 500, 0),
            file("/m/Mix.flac", 500, 0),
        ]);
        assert_eq!(upload_choice(&lossy_first, 0), Choice::Upload(1));
        let both_lossy = render(vec![file("/m/Mix.ogg", 500, 0), file("/m/Mix.aac", 500, 0)]);
        assert_eq!(upload_choice(&both_lossy, 0), Choice::Upload(1));
    }

    #[test]
    fn a_huge_limit_does_not_overflow() {
        let pair = render(vec![file("/m/Mix.wav", u64::MAX, 0)]);
        assert_eq!(upload_choice(&pair, u64::MAX), Choice::Upload(0));
    }

    #[test]
    fn a_render_with_no_files_has_nothing_to_upload() {
        let empty = Render {
            name: "x".into(),
            files: Vec::new(),
        };
        assert_eq!(upload_choice(&empty, 0), Choice::OverLimit);
        assert_eq!(empty.mtime_ms(), 0);
    }

    fn written_at(times_ms: &[i64]) -> Vec<Render> {
        times_ms
            .iter()
            .enumerate()
            .map(|(index, time)| render(vec![file(&format!("/m/stem{index}.wav"), 1, *time)]))
            .collect()
    }

    #[test]
    fn three_renders_within_a_minute_are_a_batch() {
        let renders = written_at(&[0, 20_000, 40_000]);
        assert_eq!(batches(&renders), [vec![0, 1, 2]]);
    }

    #[test]
    fn two_renders_are_not_a_batch() {
        assert!(batches(&written_at(&[0, 1_000])).is_empty());
    }

    #[test]
    fn an_export_that_takes_minutes_is_one_batch_because_the_files_chain() {
        let times: Vec<i64> = (0..10).map(|n| n * 30_000).collect();
        let found = batches(&written_at(&times));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], (0..10).collect::<Vec<_>>());
    }

    #[test]
    fn the_gap_at_the_window_still_chains_and_one_millisecond_more_does_not() {
        assert_eq!(batches(&written_at(&[0, 60_000, 120_000])).len(), 1);
        assert!(batches(&written_at(&[0, 60_001, 120_002])).is_empty());
    }

    #[test]
    fn a_long_gap_splits_one_batch_from_a_lone_render() {
        let renders = written_at(&[0, 5_000, 10_000, 15_000, 500_000]);
        assert_eq!(batches(&renders), [vec![0, 1, 2, 3]]);
    }

    #[test]
    fn two_batches_apart_come_back_in_time_order_with_indices_ascending() {
        let renders = written_at(&[900_000, 0, 910_000, 10_000, 920_000, 20_000]);
        assert_eq!(batches(&renders), [vec![1, 3, 5], vec![0, 2, 4]]);
    }

    #[test]
    fn a_pair_counts_once_at_its_newest_file() {
        let renders = vec![
            render(vec![file("/m/a.wav", 1, 0), file("/m/a.mp3", 1, 1_000)]),
            render(vec![file("/m/b.wav", 1, 30_000)]),
        ];
        assert!(
            batches(&renders).is_empty(),
            "two renders, however many files"
        );
    }

    #[test]
    fn a_file_is_due_once_held_for_a_minute() {
        assert!(!due_after_hold(1_000, 1_000));
        assert!(!due_after_hold(1_000, 60_999));
        assert!(due_after_hold(1_000, 61_000));
        assert!(due_after_hold(1_000, 1_000_000));
    }

    #[test]
    fn a_clock_that_went_backwards_holds_the_file() {
        assert!(!due_after_hold(1_000_000, 10));
        assert!(!due_after_hold(i64::MAX, i64::MIN));
    }
}
