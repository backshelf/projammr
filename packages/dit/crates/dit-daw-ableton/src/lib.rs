//! The Ableton Live module of dit: reads a Live set into dit-core's objects.

use std::io;
use std::path::{Path, PathBuf};

use dit_core::{Backup, Daw, DawError, LogState, SampleRef, ScriptKit, SetMeta, TitleHint, Tree};

mod backups;
mod gzip;
mod mask;
mod openset;
mod parse;
mod project;
mod script;
mod split;

pub struct Ableton;

impl Daw for Ableton {
    fn id(&self) -> &'static str {
        "ableton"
    }

    fn display_name(&self) -> &'static str {
        "Ableton Live"
    }

    fn set_extensions(&self) -> &'static [&'static str] {
        &["als"]
    }

    fn managed_subfolders(&self) -> &'static [&'static str] {
        &[
            "Samples",
            "Backup",
            "Freeze",
            "Recorded",
            "Ableton Project Info",
        ]
    }

    fn is_project_folder(&self, dir: &Path) -> bool {
        project::is_project_folder(dir)
    }

    fn find_sets(&self, project: &Path) -> io::Result<Vec<PathBuf>> {
        project::find_sets(project)
    }

    fn decode(&self, file: &[u8]) -> Result<Vec<u8>, DawError> {
        gzip::decode(file)
    }

    fn encode(&self, doc: &[u8]) -> Result<Vec<u8>, DawError> {
        gzip::encode(doc)
    }

    fn split(&self, doc: &[u8]) -> Result<Tree, DawError> {
        split::split(doc)
    }

    fn mask(&self, text: &[u8], side: &mut Vec<String>) -> Vec<u8> {
        mask::mask(text, side)
    }

    fn unmask(&self, text: &[u8], side: &[String]) -> Result<(Vec<u8>, usize), DawError> {
        mask::unmask(text, side)
    }

    fn parse(&self, doc: &[u8]) -> Result<SetMeta, DawError> {
        parse::parse(doc)
    }

    fn sample_refs(&self, doc: &[u8]) -> Result<Vec<SampleRef>, DawError> {
        parse::sample_refs(doc)
    }

    fn list_backups(&self, set: &Path) -> io::Result<Vec<Backup>> {
        backups::list_backups(set)
    }

    fn app_names(&self) -> &'static [&'static str] {
        &["Live"]
    }

    /// Live's own bundle identifier, as `mdls -name kMDItemCFBundleIdentifier` reads it from an installed Live 12.
    fn bundle_ids(&self) -> &'static [&'static str] {
        &["com.ableton.live"]
    }

    fn track_colour(&self, index: i64) -> Option<&'static str> {
        parse::palette::palette_color(index)
    }

    fn device_display_name(&self, class_name: &str, name: &str) -> Option<String> {
        Some(parse::device_display_name(class_name, name))
    }

    fn log_open_set(&self, home: &Path) -> io::Result<LogState> {
        openset::log_open_set(home)
    }

    fn title_hint(&self, owner: &str, title: &str) -> Option<TitleHint> {
        self.app_names()
            .contains(&owner)
            .then(|| openset::title_stem(title))
            .flatten()
            .map(|set_stem| TitleHint { set_stem })
    }

    fn project_roots(&self, home: &Path) -> io::Result<Vec<PathBuf>> {
        openset::project_roots(home)
    }

    fn script_kit(&self, home: &Path) -> Option<ScriptKit> {
        Some(script::kit(home))
    }

    fn script_enabled(&self, home: &Path) -> io::Result<Option<bool>> {
        openset::script_enabled(home)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_itself_as_ableton_with_the_als_extension() {
        assert_eq!(Ableton.id(), "ableton");
        assert_eq!(Ableton.set_extensions(), &["als"]);
        assert_eq!(Ableton.managed_subfolders().len(), 5);
    }

    #[test]
    fn colours_a_live_track_index_from_the_palette_saved_sets_use() {
        assert_eq!(Ableton.track_colour(12), Some("#e553a0"));
        assert_eq!(Ableton.track_colour(69), Some("#3c3c3c"));
        assert_eq!(Ableton.track_colour(70), None);
        assert_eq!(Ableton.track_colour(-1), None);
    }

    #[test]
    fn names_lives_bundle_identifier_for_the_app_to_open_sets_with() {
        assert_eq!(Ableton.bundle_ids(), &["com.ableton.live"]);
    }

    #[test]
    fn maps_live_device_class_names_to_saved_structure_display_names() {
        assert_eq!(
            Ableton.device_display_name("InstrumentGroupDevice", "Basic Bell Keys"),
            Some("Instrument Rack".to_string())
        );
        assert_eq!(
            Ableton.device_display_name("OriginalSimpler", "kick.wav"),
            Some("Simpler".to_string())
        );
        assert_eq!(
            Ableton.device_display_name("PluginDevice", "Pro-Q 4"),
            Some("Pro-Q 4".to_string())
        );
    }
}
