//! Splitting a set's XML into parts and leaves, joining them back, and the gzip wrapper around it.
//!
//! Each document is written as the tree it must split into, so every test asserts each part's kind, tag and id
//! and the exact bytes of each leaf, whitespace included; the document itself is the join of that tree.

use dit_core::{Daw, DawError, Leaf, LeafKind, Part, PartKind, Tree, join};
use dit_daw_ableton::Ableton;

fn text(bytes: &str) -> Leaf {
    Leaf {
        kind: LeafKind::Text,
        tag: None,
        bytes: bytes.into(),
    }
}

fn blob(tag: &str, bytes: &str) -> Leaf {
    Leaf {
        kind: LeafKind::Blob,
        tag: Some(tag.into()),
        bytes: bytes.into(),
    }
}

fn gap(bytes: &str) -> Part {
    Part {
        kind: PartKind::Gap,
        tag: None,
        id: None,
        leaves: vec![text(bytes)],
    }
}

fn track(tag: &str, id: Option<&str>, leaves: Vec<Leaf>) -> Part {
    Part {
        kind: PartKind::Track,
        tag: Some(tag.into()),
        id: id.map(Into::into),
        leaves,
    }
}

fn section(tag: &str, leaves: Vec<Leaf>) -> Part {
    Part {
        kind: PartKind::Section,
        tag: Some(tag.into()),
        id: None,
        leaves,
    }
}

fn assert_splits(expected: Tree) {
    let doc = join(&expected);
    assert_eq!(Ableton.split(&doc).expect("the document splits"), expected);
}

/// Live 12: `MainTrack`, an AU plugin's `Buffer`, a self-closing return track, and two adjacent sections.
fn live_12() -> Tree {
    Tree {
        parts: vec![
            gap(concat!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                "<Ableton MajorVersion=\"5\" MinorVersion=\"12.0_12049\" SchemaChangeCount=\"7\" ",
                "Creator=\"Ableton Live 12.1.5\" Revision=\"\">\n",
                "\t<LiveSet>\n",
                "\t\t<NextPointeeId Value=\"22155\" />\n",
                "\t\t<Tracks>",
            )),
            track(
                "MidiTrack",
                Some("8"),
                vec![text(concat!(
                    "\n\t\t\t<MidiTrack Id=\"8\">\n",
                    "\t\t\t\t<Name>\n",
                    "\t\t\t\t\t<EffectiveName Value=\"Bass\" />\n",
                    "\t\t\t\t</Name>\n",
                    "\t\t\t</MidiTrack>",
                ))],
            ),
            track(
                "AudioTrack",
                Some("12"),
                vec![
                    text(concat!(
                        "\n\t\t\t<AudioTrack Id=\"12\">\n",
                        "\t\t\t\t<DeviceChain>\n",
                        "\t\t\t\t\t<AuPluginDevice Id=\"0\">\n",
                        "\t\t\t\t\t\t<PluginDesc>\n",
                        "\t\t\t\t\t\t\t<AuPluginInfo Id=\"0\">\n",
                        "\t\t\t\t\t\t\t\t<Name Value=\"AUReverb2\" />\n",
                        "\t\t\t\t\t\t\t\t<Buffer>",
                    )),
                    blob(
                        "Buffer",
                        concat!(
                            "\n\t\t\t\t\t\t\t\t\t62706C697374303044010203040506070A\n",
                            "\t\t\t\t\t\t\t\t\t0B0C0D5F10116D616E75666163747572\n",
                            "\t\t\t\t\t\t\t\t",
                        ),
                    ),
                    text(concat!(
                        "</Buffer>\n",
                        "\t\t\t\t\t\t\t</AuPluginInfo>\n",
                        "\t\t\t\t\t\t</PluginDesc>\n",
                        "\t\t\t\t\t</AuPluginDevice>\n",
                        "\t\t\t\t</DeviceChain>\n",
                        "\t\t\t</AudioTrack>",
                    )),
                ],
            ),
            track(
                "ReturnTrack",
                Some("98"),
                vec![text("\n\t\t\t<ReturnTrack Id=\"98\" />")],
            ),
            gap("\n\t\t</Tracks>"),
            section(
                "MainTrack",
                vec![text(concat!(
                    "\n\t\t<MainTrack>\n",
                    "\t\t\t<Tempo>\n",
                    "\t\t\t\t<Manual Value=\"124\" />\n",
                    "\t\t\t</Tempo>\n",
                    "\t\t</MainTrack>",
                ))],
            ),
            section(
                "PreHearTrack",
                vec![text(concat!(
                    "\n\t\t<PreHearTrack>\n",
                    "\t\t\t<Name Value=\"\" />\n",
                    "\t\t</PreHearTrack>",
                ))],
            ),
            gap(concat!(
                "\n\t\t<SendsPre>\n",
                "\t\t\t<SendPreBool Id=\"0\" Value=\"false\" />\n",
                "\t\t</SendsPre>",
            )),
            section(
                "Scenes",
                vec![text(concat!(
                    "\n\t\t<Scenes>\n",
                    "\t\t\t<Scene Id=\"0\">\n",
                    "\t\t\t\t<Name Value=\"Intro\" />\n",
                    "\t\t\t</Scene>\n",
                    "\t\t</Scenes>",
                ))],
            ),
            gap(concat!(
                "\n\t\t<Transport>\n",
                "\t\t\t<LoopOn Value=\"false\" />\n",
                "\t\t</Transport>\n",
                "\t</LiveSet>\n",
                "</Ableton>\n",
            )),
        ],
    }
}

/// Live 11: `MasterTrack` with a plugin, VST3 processor and controller state, comments, CDATA, and
/// self-closing sections.
fn live_11() -> Tree {
    Tree {
        parts: vec![
            gap(concat!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                "<Ableton MajorVersion=\"5\" MinorVersion=\"11.0_11300\" Creator=\"Ableton Live 11.3.21\">\n",
                "\t<!-- <Tracks> in a comment opens nothing -->\n",
                "\t<LiveSet>\n",
                "\t\t<Tracks>",
            )),
            track(
                "GroupTrack",
                Some("3"),
                vec![text(concat!(
                    "\n\t\t\t<GroupTrack Id=\"3\">\n",
                    "\t\t\t\t<Name Value=\"Drums\" />\n",
                    "\t\t\t</GroupTrack>",
                ))],
            ),
            track(
                "MidiTrack",
                Some("4"),
                vec![
                    text(concat!(
                        "\n\t\t\t<MidiTrack Id=\"4\">\n",
                        "\t\t\t\t<!-- <AudioTrack Id=\"99\"> is not a track -->\n",
                        "\t\t\t\t<PluginDevice Id=\"1\">\n",
                        "\t\t\t\t\t<PluginDesc>\n",
                        "\t\t\t\t\t\t<Vst3PluginInfo Id=\"0\">\n",
                        "\t\t\t\t\t\t\t<Preset>\n",
                        "\t\t\t\t\t\t\t\t<Vst3Preset Id=\"2\">\n",
                        "\t\t\t\t\t\t\t\t\t<ProcessorState>",
                    )),
                    blob(
                        "ProcessorState",
                        concat!(
                            "\n\t\t\t\t\t\t\t\t\t\t56737443000000000000\n",
                            "\t\t\t\t\t\t\t\t\t",
                        ),
                    ),
                    text("</ProcessorState>\n\t\t\t\t\t\t\t\t\t<ControllerState>"),
                    blob(
                        "ControllerState",
                        "\n\t\t\t\t\t\t\t\t\t\t4A554345\n\t\t\t\t\t\t\t\t\t",
                    ),
                    text(concat!(
                        "</ControllerState>\n",
                        "\t\t\t\t\t\t\t\t</Vst3Preset>\n",
                        "\t\t\t\t\t\t\t</Preset>\n",
                        "\t\t\t\t\t\t</Vst3PluginInfo>\n",
                        "\t\t\t\t\t</PluginDesc>\n",
                        "\t\t\t\t</PluginDevice>\n",
                        "\t\t\t\t<Annotation><![CDATA[</MidiTrack> <Buffer> ]] > stays text]]></Annotation>\n",
                        "\t\t\t</MidiTrack>",
                    )),
                ],
            ),
            gap("\n\t\t</Tracks>"),
            section(
                "MasterTrack",
                vec![
                    text(concat!(
                        "\n\t\t<MasterTrack>\n",
                        "\t\t\t<PluginDevice Id=\"5\">\n",
                        "\t\t\t\t<PluginDesc>\n",
                        "\t\t\t\t\t<Vst3PluginInfo Id=\"0\">\n",
                        "\t\t\t\t\t\t<ProcessorState>",
                    )),
                    blob("ProcessorState", "0A0B0C"),
                    text(concat!(
                        "</ProcessorState>\n",
                        "\t\t\t\t\t</Vst3PluginInfo>\n",
                        "\t\t\t\t</PluginDesc>\n",
                        "\t\t\t</PluginDevice>\n",
                        "\t\t</MasterTrack>",
                    )),
                ],
            ),
            section("PreHearTrack", vec![text("\n\t\t<PreHearTrack />")]),
            gap("\n\t\t<SendsPre />"),
            section("Scenes", vec![text("\n\t\t<Scenes />")]),
            gap("\n\t</LiveSet>\n</Ableton>\n"),
        ],
    }
}

/// Live 10: `MasterTrack`, and `SceneNames` in place of `Scenes`, which stays in a gap.
fn live_10() -> Tree {
    Tree {
        parts: vec![
            gap(concat!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                "<Ableton MajorVersion=\"5\" MinorVersion=\"10.0_377\" Creator=\"Ableton Live 10.1.14\">\n",
                "\t<LiveSet>\n",
                "\t\t<Tracks>",
            )),
            track(
                "AudioTrack",
                Some("7"),
                vec![text(concat!(
                    "\n\t\t\t<AudioTrack Id=\"7\">\n",
                    "\t\t\t\t<Name>\n",
                    "\t\t\t\t\t<EffectiveName Value=\"Keys\" />\n",
                    "\t\t\t\t</Name>\n",
                    "\t\t\t</AudioTrack>",
                ))],
            ),
            track(
                "ReturnTrack",
                Some("2"),
                vec![text(concat!(
                    "\n\t\t\t<ReturnTrack Id=\"2\">\n",
                    "\t\t\t\t<Name>\n",
                    "\t\t\t\t\t<EffectiveName Value=\"A Reverb\" />\n",
                    "\t\t\t\t</Name>\n",
                    "\t\t\t</ReturnTrack>",
                ))],
            ),
            gap("\n\t\t</Tracks>"),
            section(
                "MasterTrack",
                vec![text(
                    "\n\t\t<MasterTrack>\n\t\t\t<Name Value=\"Master\" />\n\t\t</MasterTrack>",
                )],
            ),
            section(
                "PreHearTrack",
                vec![text(
                    "\n\t\t<PreHearTrack>\n\t\t\t<Name Value=\"\" />\n\t\t</PreHearTrack>",
                )],
            ),
            gap(concat!(
                "\n\t\t<SceneNames>\n",
                "\t\t\t<Scene Id=\"0\" Value=\"\" />\n",
                "\t\t\t<Scene Id=\"1\" Value=\"Drop\" />\n",
                "\t\t</SceneNames>\n",
                "\t\t<Transport />\n",
                "\t</LiveSet>\n",
                "</Ableton>\n",
            )),
        ],
    }
}

/// Quoted `>` and `/`, a processing instruction, empty and nested blobs, adjacent tracks, and ids that are
/// missing, spaced out or entity-encoded.
fn edge_cases() -> Tree {
    Tree {
        parts: vec![
            gap(concat!(
                "<!DOCTYPE Ableton>\n",
                "<Ableton>\n",
                "\t<LiveSet>\n",
                "\t\t<Tracks>\n",
                "\t\t\t<!-- the gap ends at this comment -->",
            )),
            track(
                "AudioTrack",
                Some("3"),
                vec![
                    text(concat!(
                        "\n\t\t\t<AudioTrack Note=\"a > b/c\" Id='3' Label=\"x/>\">\n",
                        "\t\t\t\t<?marker a > b?>\n",
                        "\t\t\t\t<Buffer />\n",
                        "\t\t\t\t<Buffer></Buffer>\n",
                        "\t\t\t\t<ProcessorState>",
                    )),
                    blob(
                        "ProcessorState",
                        "\n\t\t\t\t\t00FF\n\t\t\t\t\t<Buffer>11EE</Buffer>\n\t\t\t\t",
                    ),
                    text("</ProcessorState>\n\t\t\t</AudioTrack>"),
                ],
            ),
            track(
                "MidiTrack",
                None,
                vec![text(
                    "<MidiTrack LomId=\"5\">\n\t\t\t\t<Name Value=\"no id\" />\n\t\t\t</MidiTrack>",
                )],
            ),
            track(
                "GroupTrack",
                Some("&amp;7"),
                vec![text("\n\t\t\t<GroupTrack LomId=\"1\" Id = \"&amp;7\"/>")],
            ),
            gap("\n\t\t</Tracks>\n\t</LiveSet>\n</Ableton>"),
        ],
    }
}

fn no_tracks() -> Tree {
    Tree {
        parts: vec![gap(concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
            "<Ableton>\n",
            "\t<LiveSet>\n",
            "\t\t<Transport />\n",
            "\t</LiveSet>\n",
            "</Ableton>\n",
        ))],
    }
}

fn documents() -> Vec<Vec<u8>> {
    [live_12(), live_11(), live_10(), edge_cases(), no_tracks()]
        .iter()
        .map(join)
        .collect()
}

#[test]
fn splits_a_live_12_set() {
    assert_splits(live_12());
}

#[test]
fn splits_a_live_11_set() {
    assert_splits(live_11());
}

#[test]
fn splits_a_live_10_set() {
    assert_splits(live_10());
}

#[test]
fn splits_quoted_markup_blobs_and_ids_by_the_same_rule() {
    assert_splits(edge_cases());
}

#[test]
fn a_document_without_tracks_is_one_gap() {
    assert_splits(no_tracks());
}

#[test]
fn an_empty_document_has_no_parts() {
    assert_eq!(Ableton.split(b"").unwrap(), Tree::default());
}

#[test]
fn refuses_malformed_documents() {
    let cases: [&[u8]; 12] = [
        b"<Ableton></LiveSet>",
        b"</Ableton>",
        b"<Ableton><LiveSet>",
        b"<Ableton><LiveSet",
        b"<Ableton Creator=\"Live>",
        b"<Ableton><LiveSet <Tracks></Tracks></LiveSet></Ableton>",
        b"<Ableton><!-- never closed",
        b"<Ableton><![CDATA[ never closed",
        b"<?xml version=\"1.0\"",
        b"<Ableton>< LiveSet/></Ableton>",
        b"<Ableton></></Ableton>",
        b"<Ableton><LiveSet><Tracks><\xffTrack /></Tracks></LiveSet></Ableton>",
    ];
    for doc in cases {
        assert!(
            matches!(Ableton.split(doc), Err(DawError::Malformed(_))),
            "{:?} should be malformed",
            String::from_utf8_lossy(doc)
        );
    }
}

/// Splits `doc` and checks the tree it gives, or that it refused the document as malformed.
fn assert_split_is_exact_or_malformed(doc: &[u8]) {
    match Ableton.split(doc) {
        Ok(tree) => {
            assert_eq!(join(&tree), doc);
            for part in &tree.parts {
                assert!(!part.leaves.is_empty());
                for leaf in &part.leaves {
                    assert!(!leaf.bytes.is_empty());
                    if part.kind == PartKind::Gap {
                        assert_eq!(leaf.kind, LeafKind::Text);
                    }
                }
            }
        }
        Err(DawError::Malformed(_)) => {}
        Err(other) => panic!("unexpected error {other:?}"),
    }
}

#[test]
fn every_truncation_splits_exactly_or_is_malformed() {
    for doc in documents() {
        for cut in 0..=doc.len() {
            assert_split_is_exact_or_malformed(&doc[..cut]);
        }
    }
}

#[test]
fn every_markup_byte_substitution_splits_exactly_or_is_malformed() {
    for doc in documents() {
        for i in 0..doc.len() {
            for &byte in b"<>/\"'!?-[]" {
                let mut mutated = doc.clone();
                mutated[i] = byte;
                assert_split_is_exact_or_malformed(&mutated);
            }
        }
    }
}

#[cfg(feature = "gzip")]
mod gzip {
    use super::*;

    const OS: u8 = if cfg!(target_os = "macos") {
        19
    } else if cfg!(target_os = "windows") {
        11
    } else {
        3
    };

    /// A document large enough that zlib fills its output buffer many times over.
    fn large_document() -> Vec<u8> {
        let mut state: u32 = 1;
        let mut doc = b"<Ableton>\n".to_vec();
        for _ in 0..40_000 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            doc.extend(format!("\t<Buffer>{state:08X}{:08X}</Buffer>\n", state >> 7).bytes());
        }
        doc.extend(b"</Ableton>\n");
        doc
    }

    fn encoded() -> Vec<u8> {
        Ableton.encode(&join(&live_12())).unwrap()
    }

    #[test]
    fn decode_of_encode_is_the_document() {
        let mut docs = documents();
        docs.push(Vec::new());
        docs.push(large_document());
        for doc in docs {
            let file = Ableton.encode(&doc).unwrap();
            assert_eq!(Ableton.decode(&file).unwrap(), doc);
        }
    }

    #[test]
    fn encode_writes_lives_header_then_the_crc32_and_length() {
        let file = Ableton.encode(b"123456789").unwrap();
        assert_eq!(file[..10], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, OS]);
        assert_eq!(file[file.len() - 8..], [0x26, 0x39, 0xf4, 0xcb, 9, 0, 0, 0]);
    }

    #[test]
    fn decode_passes_plain_xml_through() {
        for doc in documents() {
            assert_eq!(Ableton.decode(&doc).unwrap(), doc);
        }
    }

    #[test]
    fn decode_refuses_an_empty_file() {
        assert!(matches!(Ableton.decode(b""), Err(DawError::Corrupt(_))));
    }

    #[test]
    fn decode_refuses_every_truncation() {
        let file = encoded();
        for cut in 2..file.len() {
            assert!(
                matches!(Ableton.decode(&file[..cut]), Err(DawError::Corrupt(_))),
                "a gzip cut at {cut} of {} bytes should be corrupt",
                file.len()
            );
        }
    }

    #[test]
    fn decode_refuses_a_zero_filled_gzip() {
        let file = encoded();
        for from in [10, file.len() / 2, file.len() - 8] {
            let mut zeroed = file.clone();
            zeroed[from..].fill(0);
            assert!(
                matches!(Ableton.decode(&zeroed), Err(DawError::Corrupt(_))),
                "a gzip zeroed from byte {from} should be corrupt"
            );
        }
    }

    #[test]
    fn decode_refuses_a_wrong_checksum_or_length() {
        let file = encoded();
        for at in [file.len() - 8, file.len() - 1] {
            let mut flipped = file.clone();
            flipped[at] ^= 1;
            assert!(matches!(
                Ableton.decode(&flipped),
                Err(DawError::Corrupt(_))
            ));
        }
    }

    #[test]
    fn decode_refuses_bytes_after_the_gzip() {
        let mut file = encoded();
        file.extend(encoded());
        assert!(matches!(Ableton.decode(&file), Err(DawError::Corrupt(_))));
    }
}
