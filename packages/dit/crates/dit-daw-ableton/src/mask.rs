//! Masking the values Live rewrites on every save (renumbered ids, view state) into a side list, and back.

use std::sync::LazyLock;

use dit_core::DawError;
use regex::bytes::{Captures, Regex};

/// Tags whose `Id` attribute Live renumbers.
const ID_TAGS: &str = "Vst3Preset|AuPreset|VstPreset|FileRef|RelativePathElement|WarpMarker";

/// Tags whose `Value` attribute is view state or a derived display label Live
/// rewrites when track numbers shift.
const VALUE_TAGS: &str = "IsContentSelectedInDocument|IsContentSelected|SelectedEnvelope|\
    LastSelectedClipEnvelopeIndex|LastSelectedTimeableIndex|LeftTime|RightTime|LaneHeight|\
    SelectedDevice|TakeCounter|EffectiveName|UpperDisplayString";

/// Both tag lists as one alternation, so matches arrive in document order. Group 1 is the value of an
/// `Id` match, group 2 the value of a `Value` match; the value is whatever sits between the quotes.
static VOLATILE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r#"(?-u)<(?:{ID_TAGS}) Id="([^"]*)"|<(?:{VALUE_TAGS}) Value="([^"]*)""#
    ))
    .expect("the volatile-value pattern is valid")
});

fn value<'h>(caps: &Captures<'h>) -> regex::bytes::Match<'h> {
    caps.get(1)
        .or_else(|| caps.get(2))
        .expect("every alternative captures its value")
}

/// Empties every volatile value in `text`, appending the originals to `side` in document order.
/// A value that is not valid UTF-8 cannot be kept in `side`, so it stays in place.
pub(crate) fn mask(text: &[u8], side: &mut Vec<String>) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut copied = 0;
    for caps in VOLATILE.captures_iter(text) {
        let value = value(&caps);
        let Ok(original) = std::str::from_utf8(value.as_bytes()) else {
            continue;
        };
        out.extend_from_slice(&text[copied..value.start()]);
        copied = value.end();
        side.push(original.to_owned());
    }
    out.extend_from_slice(&text[copied..]);
    out
}

/// Puts the `side` values back into one masked Text leaf: the n-th match with an empty value takes
/// `side[n]`. Returns the text and how many values it used; errors when `side` runs out. Values left
/// over belong to later leaves (`dit_core::unmask_tree` checks the total).
pub(crate) fn unmask(text: &[u8], side: &[String]) -> Result<(Vec<u8>, usize), DawError> {
    let mut out = Vec::with_capacity(text.len());
    let mut copied = 0;
    let mut restored = 0;
    for caps in VOLATILE.captures_iter(text) {
        let value = value(&caps);
        if !value.is_empty() {
            continue;
        }
        let Some(original) = side.get(restored) else {
            return Err(DawError::Malformed(format!(
                "the side list has {} values left but the leaf has more masked values",
                side.len()
            )));
        };
        out.extend_from_slice(&text[copied..value.start()]);
        out.extend_from_slice(original.as_bytes());
        copied = value.end();
        restored += 1;
    }
    out.extend_from_slice(&text[copied..]);
    Ok((out, restored))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID_TAG_NAMES: [&str; 6] = [
        "Vst3Preset",
        "AuPreset",
        "VstPreset",
        "FileRef",
        "RelativePathElement",
        "WarpMarker",
    ];

    const VALUE_TAG_NAMES: [&str; 12] = [
        "IsContentSelectedInDocument",
        "IsContentSelected",
        "SelectedEnvelope",
        "LastSelectedClipEnvelopeIndex",
        "LastSelectedTimeableIndex",
        "LeftTime",
        "RightTime",
        "LaneHeight",
        "SelectedDevice",
        "TakeCounter",
        "EffectiveName",
        "UpperDisplayString",
    ];

    fn every_tag(id: &str, value: &str) -> String {
        let ids = ID_TAG_NAMES
            .iter()
            .map(|tag| format!(r#"<{tag} Id="{id}" />"#));
        let values = VALUE_TAG_NAMES
            .iter()
            .map(|tag| format!(r#"<{tag} Value="{value}" />"#));
        format!(
            "<Ableton>{}</Ableton>",
            ids.chain(values).collect::<String>()
        )
    }

    /// Unmasks a whole masked text, which must use every value in `side`.
    fn restored(text: &[u8], side: &[String]) -> Vec<u8> {
        let (out, used) = unmask(text, side).unwrap();
        assert_eq!(used, side.len());
        out
    }

    fn masked(text: &str) -> (Vec<u8>, Vec<String>) {
        let mut side = Vec::new();
        let out = mask(text.as_bytes(), &mut side);
        (out, side)
    }

    #[test]
    fn unmask_of_mask_restores_a_document_with_every_tag() {
        let doc = every_tag("17", "true");
        let (out, side) = masked(&doc);
        assert_eq!(side.len(), 18);
        assert_eq!(restored(&out, &side), doc.as_bytes());
    }

    #[test]
    fn mask_empties_the_values_and_keeps_document_order() {
        let doc = r#"<FileRef Id="3" /><LeftTime Value="1.5" /><WarpMarker Id="9" />"#;
        let (out, side) = masked(doc);
        assert_eq!(
            out,
            br#"<FileRef Id="" /><LeftTime Value="" /><WarpMarker Id="" />"#
        );
        assert_eq!(side, ["3", "1.5", "9"]);
    }

    #[test]
    fn documents_differing_only_in_id_values_mask_identically() {
        let (a, _) = masked(&every_tag("1", "true"));
        let (b, _) = masked(&every_tag("2", "true"));
        assert_eq!(a, b);
    }

    #[test]
    fn documents_differing_only_in_view_state_values_mask_identically() {
        let (a, _) = masked(&every_tag("1", "true"));
        let (b, _) = masked(&every_tag("1", "false"));
        assert_eq!(a, b);
    }

    #[test]
    fn untouched_attributes_and_other_tags_are_left_alone() {
        let doc = r#"<FileRef Value="1" /><LeftTime Id="2" /><Other Id="3" /><Vst3Preset Id="4" Name="x" />"#;
        let (out, side) = masked(doc);
        assert_eq!(
            out,
            br#"<FileRef Value="1" /><LeftTime Id="2" /><Other Id="3" /><Vst3Preset Id="" Name="x" />"#
        );
        assert_eq!(side, ["4"]);
    }

    #[test]
    fn an_already_empty_value_is_still_pushed_and_round_trips() {
        let doc = r#"<FileRef Id="" /><LeftTime Value="7" />"#;
        let (out, side) = masked(doc);
        assert_eq!(side, ["", "7"]);
        assert_eq!(restored(&out, &side), doc.as_bytes());
    }

    #[test]
    fn a_value_that_is_not_utf8_is_left_in_place_and_skipped_by_unmask() {
        let mut doc = br#"<FileRef Id=""#.to_vec();
        doc.extend_from_slice(&[0xff, 0xfe]);
        doc.extend_from_slice(br#"" /><LeftTime Value="3" />"#);
        let mut side = Vec::new();
        let out = mask(&doc, &mut side);
        assert_eq!(side, ["3"]);
        assert_eq!(restored(&out, &side), doc);
    }

    #[test]
    fn a_document_masked_in_pieces_unmasks_to_the_original() {
        let pieces = [
            r#"<Root><FileRef Id="1" />"#,
            r#"<Track Id="5"><LaneHeight Value="68" />"#,
            r#"<WarpMarker Id="2" /></Track>"#,
            r#"<TakeCounter Value="4" /></Root>"#,
        ];
        let mut side = Vec::new();
        let masked: Vec<u8> = pieces
            .iter()
            .flat_map(|piece| mask(piece.as_bytes(), &mut side))
            .collect();
        assert_eq!(side, ["1", "68", "2", "4"]);
        assert_eq!(restored(&masked, &side), pieces.concat().as_bytes());
    }

    #[test]
    fn a_short_side_list_is_malformed() {
        let (out, mut side) = masked(&every_tag("1", "true"));
        side.pop();
        assert!(matches!(unmask(&out, &side), Err(DawError::Malformed(_))));
    }

    #[test]
    fn a_leaf_uses_only_its_own_values_and_leaves_the_rest() {
        let (out, mut side) = masked(&every_tag("1", "true"));
        side.push("for a later leaf".to_owned());
        let (text, used) = unmask(&out, &side).unwrap();
        assert_eq!(text, every_tag("1", "true").as_bytes());
        assert_eq!(used, side.len() - 1);
    }

    /// Splits, masks and unmasks a document the way the repo stores and
    /// materialises a save.
    fn round_trip(doc: &str) -> Vec<u8> {
        let tree = crate::split::split(doc.as_bytes()).unwrap();
        let (masked, side) = dit_core::mask_tree(&crate::Ableton, &tree);
        dit_core::unmask_tree(&crate::Ableton, &masked, &side).unwrap()
    }

    /// The contract suite's mask round trip proves something only while a
    /// fixture has values to mask and blobs to pass over.
    #[cfg(feature = "gzip")]
    #[test]
    fn the_volatile_fixture_has_values_to_mask_and_blob_leaves() {
        use dit_core::{Daw, LeafKind};
        let file = include_bytes!("../fixtures/Contract Fixtures Project/Volatile Set.als");
        let doc = crate::Ableton.decode(file).unwrap();
        let tree = crate::split::split(&doc).unwrap();
        let (_, side) = dit_core::mask_tree(&crate::Ableton, &tree);
        assert_eq!(side.len(), 12);
        let blobs = tree
            .parts
            .iter()
            .flat_map(|part| &part.leaves)
            .filter(|leaf| leaf.kind == LeafKind::Blob)
            .count();
        assert_eq!(blobs, 2);
    }

    #[test]
    fn an_empty_volatile_value_inside_a_blob_survives_the_round_trip() {
        let doc = r#"<Ableton><LiveSet><Tracks><AudioTrack Id="1"><ProcessorState><LeftTime Value="" /></ProcessorState><LeftTime Value="5" /></AudioTrack></Tracks></LiveSet></Ableton>"#;
        assert_eq!(round_trip(doc), doc.as_bytes());
    }

    #[test]
    fn a_match_opened_in_a_comment_before_a_leaf_boundary_survives_the_round_trip() {
        let doc = r#"<Ableton><LiveSet><!-- <FileRef Id=" --><MainTrack><LaneHeight Value="68" /></MainTrack></LiveSet></Ableton>"#;
        assert_eq!(round_trip(doc), doc.as_bytes());
    }

    #[test]
    fn tracks_differing_only_in_auto_numbered_effective_name_or_routing_label_mask_identically() {
        let before = r##"<AudioTrack Id="42"><Name><EffectiveName Value="35 Audio" /><UserName Value="# Audio" /></Name><AudioOutputRouting><Target Value="AudioOut/Track.9" /><UpperDisplayString Value="9-Group" /></AudioOutputRouting></AudioTrack>"##;
        let after = r##"<AudioTrack Id="42"><Name><EffectiveName Value="34 Audio" /><UserName Value="# Audio" /></Name><AudioOutputRouting><Target Value="AudioOut/Track.9" /><UpperDisplayString Value="8-Group" /></AudioOutputRouting></AudioTrack>"##;
        let (a, a_side) = masked(before);
        let (b, b_side) = masked(after);
        assert_eq!(a, b);
        assert_eq!(restored(&a, &a_side), before.as_bytes());
        assert_eq!(restored(&b, &b_side), after.as_bytes());
    }
}
