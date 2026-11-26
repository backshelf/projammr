//! Display names for Live's built-in devices.
//!
//! Live writes a built-in device as an XML element name that only loosely
//! resembles what the device is called in the UI: an EQ Eight is `<Eq8>`, a
//! Simpler is `<OriginalSimpler>`, and Auto Filter picked up a "2" when Live 10
//! replaced its implementation. Anything absent from the map falls back to
//! splitting the element name on capitals, which reads correctly for the
//! majority of devices (`<MultibandDynamics>`, `<GlueCompressor>`,
//! `<SpectralResonator>`).

const DEVICE_DISPLAY_NAMES: [(&str, &str); 29] = [
    ("AudioEffectGroupDevice", "Audio Effect Rack"),
    ("AutoFilter2", "Auto Filter"),
    ("AutoPan", "Auto Pan"),
    ("BeatRepeat", "Beat Repeat"),
    ("ChannelEq", "Channel EQ"),
    ("Chorus2", "Chorus-Ensemble"),
    ("Compressor2", "Compressor"),
    ("Corpus", "Corpus"),
    ("DrumGroupDevice", "Drum Rack"),
    ("Eq8", "EQ Eight"),
    ("FilterEQ3", "EQ Three"),
    ("Flanger", "Phaser-Flanger"),
    ("GlueCompressor", "Glue Compressor"),
    ("InstrumentGroupDevice", "Instrument Rack"),
    ("InstrumentImpulse", "Impulse"),
    ("InstrumentVector", "Wavetable"),
    ("MidiEffectGroupDevice", "MIDI Effect Rack"),
    ("MultiSampler", "Sampler"),
    ("MultibandDynamics", "Multiband Dynamics"),
    ("OriginalSimpler", "Simpler"),
    ("Operator", "Operator"),
    ("Pitch", "Pitch"),
    ("Redux2", "Redux"),
    ("Reverb", "Reverb"),
    ("Saturator", "Saturator"),
    ("StereoGain", "Utility"),
    ("Tuner", "Tuner"),
    ("UltraAnalog", "Analog"),
    ("Vocoder", "Vocoder"),
];

/// What the UI calls the built-in device written as `element`.
pub(super) fn display_name(element: &str) -> String {
    DEVICE_DISPLAY_NAMES
        .iter()
        .find(|(name, _)| *name == element)
        .map_or_else(
            || split_on_capitals(element),
            |(_, shown)| (*shown).to_string(),
        )
}

/// Splits an element name on capitals: `GlueCompressor` becomes `Glue
/// Compressor`, and a run of capitals keeps together up to its last letter
/// (`MIDIEffect` becomes `MIDI Effect`).
fn split_on_capitals(element: &str) -> String {
    let chars: Vec<char> = element.chars().collect();
    let mut out = String::with_capacity(element.len() + 4);
    for (i, &c) in chars.iter().enumerate() {
        let previous = i.checked_sub(1).map(|p| chars[p]);
        let next = chars.get(i + 1).copied();
        let after_lower_or_digit =
            previous.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit());
        let ends_a_run_of_capitals = previous.is_some_and(|p| p.is_ascii_uppercase())
            && next.is_some_and(|n| n.is_ascii_lowercase());
        if c.is_ascii_uppercase() && (after_lower_or_digit || ends_a_run_of_capitals) {
            out.push(' ');
        }
        out.push(c);
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mapped_element_gets_its_ui_name() {
        assert_eq!(display_name("Eq8"), "EQ Eight");
        assert_eq!(display_name("OriginalSimpler"), "Simpler");
        assert_eq!(display_name("AutoFilter2"), "Auto Filter");
        assert_eq!(display_name("DrumGroupDevice"), "Drum Rack");
    }

    #[test]
    fn an_unmapped_element_is_split_on_capitals() {
        assert_eq!(display_name("SpectralResonator"), "Spectral Resonator");
        assert_eq!(display_name("Delay"), "Delay");
    }

    #[test]
    fn a_run_of_capitals_and_digits_split_where_a_word_starts() {
        assert_eq!(split_on_capitals("MIDIEffect"), "MIDI Effect");
        assert_eq!(split_on_capitals("Delay2Tap"), "Delay2 Tap");
        assert_eq!(split_on_capitals(""), "");
    }
}
