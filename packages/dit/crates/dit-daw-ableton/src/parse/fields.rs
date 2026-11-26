//! The set's scalar fields, read by tag path under `LiveSet`: tempo and time
//! signature from the master track, the scale, and the track and scene counts.

use dit_core::SetMeta;

use super::{Path, Tag, Visitor};

const ROOT_NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// The master track's mixer: `MainTrack` in Live 12, `MasterTrack` before it.
const MASTER_MIXER: [&str; 5] = [
    "*",
    "LiveSet",
    "MainTrack|MasterTrack",
    "DeviceChain",
    "Mixer",
];

/// Live packs a time signature into one number: the numerator less one, plus
/// this much for each doubling of the denominator.
const TIME_SIGNATURE_STEP: i64 = 99;

/// Live offers denominators 1, 2, 4, 8 and 16.
const MAX_DENOMINATOR_STEPS: i64 = 4;

#[derive(Default)]
pub(super) struct Fields {
    version: Option<String>,
    tempo_manual: Option<f64>,
    tempo_effective: Option<f64>,
    numerator: Option<u32>,
    denominator: Option<u32>,
    encoded_time_signature: Option<String>,
    root_note: Option<String>,
    scale: Option<String>,
    tracks: Option<i64>,
    scenes: Option<i64>,
    scene_names: Option<i64>,
}

impl Visitor for Fields {
    fn start(&mut self, path: &Path, tag: &Tag) {
        if path.is(&["Ableton"]) {
            self.version = live_version(tag);
        } else if path.starts_with(&MASTER_MIXER) {
            self.master_mixer_field(path, tag);
        } else if path.is(&["*", "LiveSet", "ScaleInformation", "RootNote"]) {
            self.root_note = self.root_note.take().or_else(|| root_note(tag));
        } else if path.is(&["*", "LiveSet", "ScaleInformation", "Name"]) {
            self.scale = self.scale.take().or_else(|| scale(tag));
        } else if path.is(&["*", "LiveSet", "Tracks"]) {
            self.tracks.get_or_insert(0);
        } else if path.is(&["*", "LiveSet", "Tracks", "AudioTrack|MidiTrack"]) {
            *self.tracks.get_or_insert(0) += 1;
        } else if path.is(&["*", "LiveSet", "Scenes"]) {
            self.scenes.get_or_insert(0);
        } else if path.is(&["*", "LiveSet", "Scenes", "Scene"]) {
            *self.scenes.get_or_insert(0) += 1;
        } else if path.is(&["*", "LiveSet", "SceneNames"]) {
            self.scene_names.get_or_insert(0);
        } else if path.is(&["*", "LiveSet", "SceneNames", "Scene"]) {
            *self.scene_names.get_or_insert(0) += 1;
        }
    }
}

impl Fields {
    /// `Tempo/Manual`, `Tempo/Effective` and the `TimeSignature` children,
    /// each read once: the master's own, never a clip's or a device's.
    fn master_mixer_field(&mut self, path: &Path, tag: &Tag) {
        let depth = MASTER_MIXER.len();
        match (path.at(depth), path.at(depth + 1), path.depth() - depth) {
            (Some("Tempo"), Some("Manual"), 2) => {
                self.tempo_manual = self.tempo_manual.or_else(|| tempo(tag));
            }
            (Some("Tempo"), Some("Effective"), 2) => {
                self.tempo_effective = self.tempo_effective.or_else(|| tempo(tag));
            }
            (Some("TimeSignature"), Some("Numerator"), 2) => {
                self.numerator = self.numerator.or_else(|| whole_number(tag));
            }
            (Some("TimeSignature"), Some("Denominator"), 2) => {
                self.denominator = self.denominator.or_else(|| whole_number(tag));
            }
            (Some("TimeSignature"), Some("Manual"), 2) => {
                self.encoded_time_signature = self
                    .encoded_time_signature
                    .take()
                    .or_else(|| tag.attr("Value"));
            }
            _ => {}
        }
    }

    pub(super) fn fill(self, meta: &mut SetMeta) {
        meta.daw_version = self.version;
        meta.tempo = self.tempo_manual.or(self.tempo_effective).map(render_tempo);
        meta.time_signature = match (self.numerator, self.denominator) {
            (Some(numerator), Some(denominator)) => Some(format!("{numerator}/{denominator}")),
            _ => self
                .encoded_time_signature
                .as_deref()
                .and_then(decode_time_signature),
        };
        meta.root_note = self.root_note;
        meta.scale = self.scale;
        meta.tracks_count = self.tracks;
        meta.scenes_count = self.scenes.or(self.scene_names);
    }
}

/// `Creator` on the root ("Ableton Live 11.3.10"), else `Live <MajorVersion>`.
fn live_version(tag: &Tag) -> Option<String> {
    tag.attr("Creator")
        .filter(|creator| !creator.is_empty())
        .or_else(|| {
            tag.attr("MajorVersion")
                .filter(|major| !major.is_empty())
                .map(|major| format!("Live {major}"))
        })
}

/// A tempo value: digits and dots only, so a sign or an exponent is not one.
fn tempo(tag: &Tag) -> Option<f64> {
    let value = tag.attr("Value")?;
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    value.parse().ok().filter(|tempo: &f64| tempo.is_finite())
}

/// A tempo to two decimals with no trailing zeros: `127`, `127.5`, `127.25`.
fn render_tempo(tempo: f64) -> String {
    ((tempo * 100.0).round() / 100.0).to_string()
}

fn whole_number(tag: &Tag) -> Option<u32> {
    let value = tag.attr("Value")?;
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

/// `numerator = v % 99 + 1`, `denominator = 2^(v / 99)`: 201 is 4/4, 302 is
/// 6/8. `None` for a value that is not a whole number, or is outside what Live
/// can write.
fn decode_time_signature(value: &str) -> Option<String> {
    let value: i64 = value.trim().parse().ok()?;
    if !(0..(MAX_DENOMINATOR_STEPS + 1) * TIME_SIGNATURE_STEP).contains(&value) {
        return None;
    }
    let numerator = value % TIME_SIGNATURE_STEP + 1;
    let denominator = 1_i64 << (value / TIME_SIGNATURE_STEP);
    Some(format!("{numerator}/{denominator}"))
}

fn root_note(tag: &Tag) -> Option<String> {
    let index: usize = whole_number(tag)?.try_into().ok()?;
    ROOT_NOTE_NAMES.get(index).map(|name| (*name).to_string())
}

/// Live 11 and earlier write the scale's name ("Minor"); Live 12 writes a bare
/// index into a mode table this does not have, so a number is no scale.
fn scale(tag: &Tag) -> Option<String> {
    tag.attr("Value")
        .filter(|name| !name.is_empty() && !name.chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use dit_core::SetMeta;

    use crate::parse::parse;

    fn meta(doc: &str) -> SetMeta {
        parse(doc.as_bytes()).unwrap()
    }

    /// A Live 11 set: master mixer, scale, tracks, scenes and one sample.
    const LIVE_11_SET: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_11300" SchemaChangeCount="3" Creator="Ableton Live 11.3.10" Revision="">
  <LiveSet>
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo>
            <Manual Value="126" />
          </Tempo>
          <TimeSignature>
            <Numerator Value="4" />
            <Denominator Value="4" />
          </TimeSignature>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <ScaleInformation>
      <RootNote Value="9" />
      <Name Value="Minor" />
    </ScaleInformation>
    <Tracks>
      <AudioTrack Id="1" />
      <AudioTrack Id="2" />
      <MidiTrack Id="3" />
      <ReturnTrack Id="4" />
    </Tracks>
    <Scenes>
      <Scene Id="0" />
      <Scene Id="1" />
    </Scenes>
    <SampleRef>
      <FileRef>
        <Name Value="kick.wav" />
        <Path Value="/Users/producer/Samples/kick.wav" />
      </FileRef>
    </SampleRef>
  </LiveSet>
</Ableton>"#;

    #[test]
    fn reads_musical_metadata_from_a_live_11_set() {
        let meta = meta(LIVE_11_SET);
        assert_eq!(meta.tempo.as_deref(), Some("126"));
        assert_eq!(meta.time_signature.as_deref(), Some("4/4"));
        assert_eq!(meta.root_note.as_deref(), Some("A"));
        assert_eq!(meta.scale.as_deref(), Some("Minor"));
        assert_eq!(meta.tracks_count, Some(3));
        assert_eq!(meta.scenes_count, Some(2));
        assert_eq!(meta.daw_version.as_deref(), Some("Ableton Live 11.3.10"));
        assert_eq!(
            meta.sample_paths,
            Some(vec!["/Users/producer/Samples/kick.wav".to_string()])
        );
        assert_eq!(meta.structure, None);
    }

    /// A master track under `tag` whose mixer holds `mixer`.
    fn master(tag: &str, mixer: &str) -> String {
        format!(
            "<Ableton><LiveSet><{tag}><DeviceChain><Mixer>{mixer}</Mixer></DeviceChain></{tag}></LiveSet></Ableton>"
        )
    }

    #[test]
    fn a_clip_level_tempo_before_the_master_does_not_win() {
        let doc = r#"<Ableton><LiveSet>
            <Tracks><AudioTrack Id="1"><DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
              <AudioClip Id="0"><Tempo><Manual Value="90"/></Tempo><TimeSignature><Numerator Value="7"/><Denominator Value="8"/></TimeSignature></AudioClip>
            </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain></AudioTrack></Tracks>
            <MainTrack><DeviceChain><Mixer>
              <Tempo><Manual Value="128"/></Tempo>
              <TimeSignature><Manual Value="201"/></TimeSignature>
            </Mixer></DeviceChain></MainTrack>
        </LiveSet></Ableton>"#;
        let meta = meta(doc);
        assert_eq!(meta.tempo.as_deref(), Some("128"));
        assert_eq!(meta.time_signature.as_deref(), Some("4/4"));
    }

    #[test]
    fn a_device_level_tempo_beside_the_master_mixer_is_ignored() {
        let doc = master(
            "MainTrack",
            r#"<Speed><Tempo><Manual Value="60"/></Tempo></Speed><Tempo><Manual Value="128"/></Tempo>"#,
        );
        assert_eq!(meta(&doc).tempo.as_deref(), Some("128"));
    }

    #[test]
    fn reads_the_master_in_both_the_live_12_and_the_earlier_track_name() {
        for tag in ["MainTrack", "MasterTrack"] {
            let doc = master(tag, r#"<Tempo><Manual Value="100"/></Tempo>"#);
            assert_eq!(meta(&doc).tempo.as_deref(), Some("100"), "{tag}");
        }
    }

    #[test]
    fn a_tempo_is_rounded_to_two_decimals_without_trailing_zeros() {
        for (written, rendered) in [
            ("127", "127"),
            ("127.0", "127"),
            ("127.5", "127.5"),
            ("127.25", "127.25"),
            ("127.254", "127.25"),
            ("127.255", "127.26"),
            ("127.999", "128"),
            ("120.10", "120.1"),
        ] {
            let doc = master(
                "MainTrack",
                &format!(r#"<Tempo><Manual Value="{written}"/></Tempo>"#),
            );
            assert_eq!(meta(&doc).tempo.as_deref(), Some(rendered), "{written}");
        }
    }

    #[test]
    fn a_tempo_without_a_manual_value_falls_back_to_the_effective_one() {
        let doc = master("MasterTrack", r#"<Tempo><Effective Value="98.5"/></Tempo>"#);
        assert_eq!(meta(&doc).tempo.as_deref(), Some("98.5"));

        let both = master(
            "MasterTrack",
            r#"<Tempo><Effective Value="98.5"/><Manual Value="99"/></Tempo>"#,
        );
        assert_eq!(meta(&both).tempo.as_deref(), Some("99"));
    }

    #[test]
    fn a_tempo_that_is_not_a_plain_number_is_null() {
        for written in ["", "abc", "-5", "1e3", "1.2.3", "."] {
            let doc = master(
                "MainTrack",
                &format!(r#"<Tempo><Manual Value="{written}"/></Tempo>"#),
            );
            assert_eq!(meta(&doc).tempo, None, "{written:?}");
        }
    }

    #[test]
    fn decodes_a_time_signature_stored_as_one_encoded_number() {
        for (encoded, rendered) in [
            ("0", "1/1"),
            ("98", "99/1"),
            ("99", "1/2"),
            ("201", "4/4"),
            ("302", "6/8"),
            ("305", "9/8"),
            ("494", "99/16"),
        ] {
            let doc = master(
                "MainTrack",
                &format!(r#"<TimeSignature><Manual Value="{encoded}"/></TimeSignature>"#),
            );
            assert_eq!(
                meta(&doc).time_signature.as_deref(),
                Some(rendered),
                "{encoded}"
            );
        }
    }

    #[test]
    fn a_time_signature_that_is_not_a_whole_in_range_number_is_null() {
        for encoded in [
            "",
            "abc",
            "-1",
            "495",
            "201.5",
            "1e2",
            "99999999999999999999",
        ] {
            let doc = master(
                "MainTrack",
                &format!(r#"<TimeSignature><Manual Value="{encoded}"/></TimeSignature>"#),
            );
            assert_eq!(meta(&doc).time_signature, None, "{encoded:?}");
        }
    }

    #[test]
    fn reads_a_time_signature_written_as_numerator_and_denominator() {
        let doc = master(
            "MasterTrack",
            r#"<TimeSignature><Numerator Value="7"/><Denominator Value="8"/></TimeSignature>"#,
        );
        assert_eq!(meta(&doc).time_signature.as_deref(), Some("7/8"));
    }

    #[test]
    fn half_a_written_time_signature_is_null_unless_the_encoded_form_is_there() {
        let half = master(
            "MainTrack",
            r#"<TimeSignature><Numerator Value="7"/></TimeSignature>"#,
        );
        assert_eq!(meta(&half).time_signature, None);

        let with_manual = master(
            "MainTrack",
            r#"<TimeSignature><Numerator Value="7"/><Manual Value="302"/></TimeSignature>"#,
        );
        assert_eq!(meta(&with_manual).time_signature.as_deref(), Some("6/8"));
    }

    #[test]
    fn a_clips_time_signature_is_never_the_sets() {
        let doc = r#"<Ableton><LiveSet><Tracks><MidiTrack Id="1"><TimeSignature><Numerator Value="5"/><Denominator Value="4"/></TimeSignature></MidiTrack></Tracks></LiveSet></Ableton>"#;
        assert_eq!(meta(doc).time_signature, None);
    }

    #[test]
    fn maps_every_root_note_index_to_its_name() {
        let names = [
            "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
        ];
        for (index, name) in names.iter().enumerate() {
            let doc = format!(
                r#"<Ableton><LiveSet><ScaleInformation><RootNote Value="{index}"/></ScaleInformation></LiveSet></Ableton>"#
            );
            assert_eq!(meta(&doc).root_note.as_deref(), Some(*name));
        }
        for out_of_range in ["12", "-1", "x", ""] {
            let doc = format!(
                r#"<Ableton><LiveSet><ScaleInformation><RootNote Value="{out_of_range}"/></ScaleInformation></LiveSet></Ableton>"#
            );
            assert_eq!(meta(&doc).root_note, None, "{out_of_range:?}");
        }
    }

    #[test]
    fn a_scale_written_as_a_bare_index_is_dropped() {
        let named = r#"<Ableton><LiveSet><ScaleInformation><RootNote Value="0"/><Name Value="Major"/></ScaleInformation></LiveSet></Ableton>"#;
        assert_eq!(meta(named).scale.as_deref(), Some("Major"));

        let indexed = r#"<Ableton><LiveSet><ScaleInformation><RootNote Value="0"/><Name Value="3"/></ScaleInformation></LiveSet></Ableton>"#;
        let indexed = meta(indexed);
        assert_eq!(indexed.scale, None);
        assert_eq!(indexed.root_note.as_deref(), Some("C"));
    }

    #[test]
    fn a_name_outside_scale_information_is_not_the_scale() {
        let doc = r#"<Ableton><LiveSet><Name Value="Song"/><Tracks><AudioTrack><Name Value="Kick"/></AudioTrack></Tracks></LiveSet></Ableton>"#;
        assert_eq!(meta(doc).scale, None);
    }

    #[test]
    fn version_is_the_creator_else_live_and_the_major_version() {
        let creator =
            r#"<Ableton MajorVersion="5" Creator="Ableton Live 12.1.5"><LiveSet/></Ableton>"#;
        assert_eq!(
            meta(creator).daw_version.as_deref(),
            Some("Ableton Live 12.1.5")
        );

        let major = r#"<Ableton MajorVersion="5" MinorVersion="10.1.30"><LiveSet/></Ableton>"#;
        assert_eq!(meta(major).daw_version.as_deref(), Some("Live 5"));

        let empty_creator = r#"<Ableton MajorVersion="4" Creator=""><LiveSet/></Ableton>"#;
        assert_eq!(meta(empty_creator).daw_version.as_deref(), Some("Live 4"));

        assert_eq!(meta("<Ableton><LiveSet/></Ableton>").daw_version, None);
    }

    #[test]
    fn counts_only_audio_and_midi_tracks_directly_under_tracks() {
        let doc = r#"<Ableton><LiveSet>
            <Tracks>
              <AudioTrack Id="1"><DeviceChain><AudioTrack Id="9"/></DeviceChain></AudioTrack>
              <MidiTrack Id="2"/><ReturnTrack Id="3"/><GroupTrack Id="4"/>
            </Tracks>
            <MainTrack/>
        </LiveSet></Ableton>"#;
        assert_eq!(meta(doc).tracks_count, Some(2));
    }

    #[test]
    fn an_empty_tracks_element_counts_zero_and_a_missing_one_is_null() {
        assert_eq!(
            meta("<Ableton><LiveSet><Tracks/></LiveSet></Ableton>").tracks_count,
            Some(0)
        );
        assert_eq!(meta("<Ableton><LiveSet/></Ableton>").tracks_count, None);
    }

    #[test]
    fn scenes_come_from_scenes_else_from_scene_names() {
        let live_11 = r#"<Ableton><LiveSet>
            <Scenes><Scene Id="0"/><Scene Id="1"/><Scene Id="2"/></Scenes>
            <SceneNames><Scene Value="a"/></SceneNames>
        </LiveSet></Ableton>"#;
        assert_eq!(meta(live_11).scenes_count, Some(3));

        let live_10 = r#"<Ableton><LiveSet>
            <SceneNames><Scene Value="a"/><Scene Value="b"/></SceneNames>
        </LiveSet></Ableton>"#;
        assert_eq!(meta(live_10).scenes_count, Some(2));

        assert_eq!(meta("<Ableton><LiveSet/></Ableton>").scenes_count, None);
    }

    #[test]
    fn a_scene_elsewhere_in_the_set_is_not_counted() {
        let doc = r#"<Ableton><LiveSet><Tracks><AudioTrack><Scene Id="0"/></AudioTrack></Tracks><Scenes><Scene Id="0"/></Scenes></LiveSet></Ableton>"#;
        assert_eq!(meta(doc).scenes_count, Some(1));
    }

    #[test]
    fn decodes_entities_in_a_scale_name() {
        let doc = r#"<Ableton><LiveSet><ScaleInformation><Name Value="A &amp; B"/></ScaleInformation></LiveSet></Ableton>"#;
        assert_eq!(meta(doc).scale.as_deref(), Some("A & B"));
    }
}
