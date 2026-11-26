//! The set's structure: its tracks with their names, groups, colours and device
//! chains, the third-party plugins they host, and the clip and scene counts.
//!
//! A track is a direct child of `LiveSet/Tracks`. Everything else is read
//! relative to it: the same element names turn up in routing lists and frozen
//! copies further down, so a reader only accepts them at the depth Live writes
//! the real thing.

use std::collections::BTreeMap;

use dit_core::{ClipCounts, PluginInfo, SetMeta, SetStructure, StructureTrack, TrackKind};

use super::devices::display_name;
use super::palette::track_color;
use super::{Path, Tag, Visitor};

/// The tracks kept; a set with more is cut here and flagged `truncated`.
const MAX_TRACKS: usize = 256;

/// The devices kept per track, under the same rule.
const MAX_DEVICES: usize = 64;

/// A track's own element: the master is not a structure track.
const TRACK: [&str; 4] = [
    "*",
    "LiveSet",
    "Tracks",
    "AudioTrack|MidiTrack|ReturnTrack|GroupTrack",
];

/// A third-party plugin's element says nothing about which plugin it is; the
/// name lives in an info block a few levels down.
const PLUGIN_HOSTS: [&str; 3] = ["PluginDevice", "AuPluginDevice", "VstPluginDevice"];

/// Each info block names the plugin format it belongs to.
const PLUGIN_INFO_HOSTS: [(&str, &str); 3] = [
    ("Vst3PluginInfo", "vst3"),
    ("VstPluginInfo", "vst"),
    ("AuPluginInfo", "au"),
];

/// A rack holds its own `Devices` chains, one per branch. The rack is listed
/// as a single device and its branches are not descended into: a drum rack
/// alone can hold a hundred Simplers, which would swamp both the diff and the
/// inventory.
const RACKS: [&str; 4] = [
    "InstrumentGroupDevice",
    "AudioEffectGroupDevice",
    "MidiEffectGroupDevice",
    "DrumGroupDevice",
];

#[derive(Default)]
pub(super) struct Structure {
    /// The major version of Live that wrote the set, which decides how a
    /// track's colour is numbered.
    live_major: Option<u32>,
    tracks: Vec<StructureTrack>,
    audio_clips: i64,
    midi_clips: i64,
    plugins: BTreeMap<String, PluginInfo>,
    truncated: bool,
    current: Option<Current>,
}

/// The track being read, from its opening tag to its closing one.
struct Current {
    track: StructureTrack,
    /// The track is past `MAX_TRACKS`: it is not read, only noted as cut.
    skipped: bool,
    /// Whether any element opened inside it. Live writes an empty track as a
    /// self-closing element, which counts toward nothing and has no entry.
    saw_child: bool,
    audio_clips: i64,
    midi_clips: i64,
    plugins: BTreeMap<String, PluginInfo>,
    truncated: bool,
    /// Path depth of the `Devices` element whose children are being listed.
    devices_depth: Option<usize>,
    /// Path depth of the rack being skipped over.
    rack_depth: Option<usize>,
    /// The index in `track.devices` of a plugin still waiting for its name.
    pending_plugin: Option<usize>,
    /// The format of the plugin info block being read, once a plugin awaits
    /// its name.
    plugin_info: Option<&'static str>,
    /// The plugin named in the current info block, which a `Manufacturer`
    /// after it belongs to.
    last_plugin: Option<String>,
}

impl Visitor for Structure {
    fn start(&mut self, path: &Path, tag: &Tag) {
        if path.depth() == 1 {
            self.live_major = live_major(tag);
        } else if path.is(&TRACK) {
            self.current = Some(Current::open(path, tag, self.tracks.len() >= MAX_TRACKS));
        } else if let Some(current) = self.current.as_mut() {
            current.start(path, tag, self.live_major);
        }
    }

    fn end(&mut self, path: &Path) {
        if path.is(&TRACK) {
            self.close_track();
        } else if let Some(current) = self.current.as_mut() {
            current.end(path);
        }
    }
}

impl Structure {
    fn close_track(&mut self) {
        let Some(mut current) = self.current.take() else {
            return;
        };
        if !current.saw_child {
            return;
        }
        if current.skipped {
            self.truncated = true;
            return;
        }
        // A plugin whose name never arrived leaves an empty placeholder.
        current.track.devices.retain(|device| !device.is_empty());
        self.tracks.push(current.track);
        self.audio_clips += current.audio_clips;
        self.midi_clips += current.midi_clips;
        self.plugins.append(&mut current.plugins);
        self.truncated |= current.truncated;
    }

    /// Sets `meta.structure`, and leaves it null for a set with no tracks. The
    /// scene count is `meta.scenes_count`, so `Fields` must have filled it.
    pub(super) fn fill(self, meta: &mut SetMeta) {
        if self.tracks.is_empty() {
            return;
        }
        meta.structure = Some(SetStructure {
            tracks: self.tracks,
            clips: Some(ClipCounts {
                audio: self.audio_clips,
                midi: self.midi_clips,
            }),
            scenes: meta.scenes_count,
            plugins: (!self.plugins.is_empty()).then_some(self.plugins),
            truncated: self.truncated.then_some(true),
        });
    }
}

impl Current {
    fn open(path: &Path, tag: &Tag, skipped: bool) -> Self {
        let kind = match path.at(TRACK.len() - 1) {
            Some("AudioTrack") => TrackKind::Audio,
            Some("MidiTrack") => TrackKind::Midi,
            Some("ReturnTrack") => TrackKind::Return,
            _ => TrackKind::Group,
        };
        Current {
            track: StructureTrack {
                kind,
                name: String::new(),
                devices: Vec::new(),
                id: tag.attr("Id").as_deref().and_then(whole_number),
                group_id: None,
                color: None,
            },
            skipped,
            saw_child: false,
            audio_clips: 0,
            midi_clips: 0,
            plugins: BTreeMap::new(),
            truncated: false,
            devices_depth: None,
            rack_depth: None,
            pending_plugin: None,
            plugin_info: None,
            last_plugin: None,
        }
    }

    fn start(&mut self, path: &Path, tag: &Tag, live_major: Option<u32>) {
        self.saw_child = true;
        if self.skipped {
            return;
        }
        let depth = path.depth();
        let element = path.at(depth - 1).unwrap_or_default();
        let is_direct_child = depth == TRACK.len() + 1;

        // The name Live shows sits in the `Name` block directly under the track.
        if element == "EffectiveName"
            && path.at(TRACK.len()) == Some("Name")
            && let Some(name) = tag.attr("Value")
        {
            self.track.name = name;
        }

        // The group a track belongs to, named by the group track's own id. Live
        // writes -1 at the top level, and repeats the element in other contexts
        // deeper in the track, so only the direct child counts.
        if is_direct_child && element == "TrackGroupId" {
            let group = tag.attr("Value").as_deref().and_then(whole_number);
            if let Some(group) = group.filter(|group| *group >= 0) {
                self.track.group_id = Some(group);
            }
        }

        // The track's own colour sits beside its name; the clips inside the
        // track carry colours of their own further down, which are not it.
        if is_direct_child && matches!(element, "Color" | "ColorIndex") {
            let value = tag.attr("Value").as_deref().and_then(whole_number);
            if let Some(color) = value.and_then(|value| track_color(element, value, live_major)) {
                self.track.color = Some(color.to_string());
            }
        }

        // Clips anywhere in the track, frozen copies included. Live gives every
        // real clip an `Id`; the same names appear without one elsewhere.
        if tag.attr("Id").is_some() {
            match element {
                "AudioClip" => self.audio_clips += 1,
                "MidiClip" => self.midi_clips += 1,
                _ => {}
            }
        }

        // An empty chain is written as a self-closing `Devices`, which opens
        // and closes at once and so lists nothing.
        if element == "Devices" && self.devices_depth.is_none() && self.rack_depth.is_none() {
            self.devices_depth = Some(depth);
        } else if self.devices_depth.is_some_and(|chain| depth == chain + 1)
            && self.rack_depth.is_none()
            && tag.attr("Id").is_some()
        {
            self.push_device(element, depth);
        }

        self.read_plugin(element, tag);
    }

    fn end(&mut self, path: &Path) {
        if self.skipped {
            return;
        }
        let depth = path.depth();
        let element = path.at(depth - 1).unwrap_or_default();

        if element == "Devices" && self.devices_depth == Some(depth) {
            self.devices_depth = None;
        }
        if self.rack_depth == Some(depth) {
            self.rack_depth = None;
        }
        if self.plugin_info.is_some() && plugin_info_host(element).is_some() {
            self.plugin_info = None;
            self.last_plugin = None;
        }
    }

    /// Records one device of the track's own chain. A plugin host is pushed as
    /// a placeholder and filled in when its info block names it.
    fn push_device(&mut self, element: &str, depth: usize) {
        if RACKS.contains(&element) {
            self.rack_depth = Some(depth);
        }
        // Whatever the previous plugin was, its info block has been passed by now.
        self.pending_plugin = None;

        if self.track.devices.len() >= MAX_DEVICES {
            self.truncated = true;
            return;
        }
        if PLUGIN_HOSTS.contains(&element) {
            self.track.devices.push(String::new());
            self.pending_plugin = Some(self.track.devices.len() - 1);
            return;
        }
        self.track.devices.push(display_name(element));
    }

    /// Names the plugin awaiting it from the info block that follows its host,
    /// and attaches the manufacturer the block names after it. A preset's own
    /// `Name` inside the block comes once the plugin is named, so it is ignored.
    fn read_plugin(&mut self, element: &str, tag: &Tag) {
        if self.pending_plugin.is_some()
            && let Some(host) = plugin_info_host(element)
        {
            self.plugin_info = Some(host);
        }
        let (Some(host), Some(value)) = (self.plugin_info, tag.attr("Value")) else {
            return;
        };
        if let (Some(index), "Name" | "PlugName") = (self.pending_plugin, element) {
            self.track.devices[index].clone_from(&value);
            self.pending_plugin = None;
            self.plugins.insert(
                value.clone(),
                PluginInfo {
                    host: host.to_string(),
                    manufacturer: None,
                },
            );
            self.last_plugin = Some(value);
        } else if element == "Manufacturer" {
            let plugin = self
                .last_plugin
                .as_ref()
                .and_then(|name| self.plugins.get_mut(name));
            if let Some(plugin) = plugin {
                plugin.manufacturer = Some(value);
            }
        }
    }
}

fn plugin_info_host(element: &str) -> Option<&'static str> {
    PLUGIN_INFO_HOSTS
        .iter()
        .find(|(name, _)| *name == element)
        .map(|(_, host)| *host)
}

/// A whole number, as a track id, a group id or a palette index is written.
fn whole_number(text: &str) -> Option<i64> {
    text.parse().ok()
}

/// The major version of Live that wrote the set, from the root element's
/// `Creator` ("Ableton Live 12.3"), else the leading number of its
/// `MinorVersion` ("12.0_12049").
fn live_major(root: &Tag) -> Option<u32> {
    let creator = root
        .attr("Creator")
        .and_then(|creator| leading_number(creator.strip_prefix("Ableton Live ")?));
    creator.or_else(|| {
        let minor = root.attr("MinorVersion")?;
        minor.split_once('.')?.0.parse().ok()
    })
}

fn leading_number(text: &str) -> Option<u32> {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    text[..end].parse().ok()
}

#[cfg(test)]
mod tests {
    use dit_core::{ClipCounts, PluginInfo, SetMeta, SetStructure, StructureTrack, TrackKind};

    use crate::parse::parse;

    /// One track's device chain, wrapped the way Live nests it.
    fn chain(devices: &str) -> String {
        format!(
            "<DeviceChain><DeviceChain><Devices>{devices}</Devices></DeviceChain></DeviceChain>"
        )
    }

    fn named(name: &str) -> String {
        format!(r#"<Name><EffectiveName Value="{name}" /><UserName Value="" /></Name>"#)
    }

    /// Live's own group membership: -1 at the top, else the group track's id.
    fn in_group(id: i64) -> String {
        format!(r#"<TrackGroupId Value="{id}" />"#)
    }

    fn colour(element: &str, value: i64) -> String {
        format!(r#"<{element} Value="{value}" />"#)
    }

    fn live_set_by(tracks: &str, creator: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="{creator}">
  <LiveSet>
    <Tracks>{tracks}</Tracks>
    <Scenes><Scene Id="0" /></Scenes>
  </LiveSet>
</Ableton>"#
        )
    }

    fn live_set(tracks: &str) -> String {
        live_set_by(tracks, "Ableton Live 12.3")
    }

    fn meta(doc: &str) -> SetMeta {
        parse(doc.as_bytes()).unwrap()
    }

    fn structure(doc: &str) -> SetStructure {
        meta(doc).structure.expect("a structure")
    }

    fn tracks(doc: &str) -> Vec<StructureTrack> {
        structure(doc).tracks
    }

    fn track(kind: TrackKind, name: &str, id: i64, devices: &[&str]) -> StructureTrack {
        StructureTrack {
            kind,
            name: name.to_string(),
            devices: devices.iter().map(|d| (*d).to_string()).collect(),
            id: Some(id),
            group_id: None,
            color: None,
        }
    }

    fn colours(doc: &str) -> Vec<Option<String>> {
        tracks(doc).into_iter().map(|t| t.color).collect()
    }

    fn some(colour: &str) -> Option<String> {
        Some(colour.to_string())
    }

    #[test]
    fn reads_track_names_kinds_and_builtin_device_chains() {
        let doc = live_set(&format!(
            r#"
      <AudioTrack Id="19">{}{}</AudioTrack>
      <MidiTrack Id="20">{}{}</MidiTrack>
      <ReturnTrack Id="21">{}{}</ReturnTrack>
      <GroupTrack Id="22">{}{}</GroupTrack>"#,
            named("2 VOCALS"),
            chain(r#"<Reverb Id="1" /><MultibandDynamics Id="2" /><AutoFilter2 Id="3" />"#),
            named("3 Lead"),
            chain(r#"<OriginalSimpler Id="4" /><Eq8 Id="5" />"#),
            named("A Reverb"),
            chain(r#"<Reverb Id="6" />"#),
            named("DRUMS"),
            chain(""),
        ));
        let structure = structure(&doc);

        assert_eq!(
            structure.tracks,
            [
                track(
                    TrackKind::Audio,
                    "2 VOCALS",
                    19,
                    &["Reverb", "Multiband Dynamics", "Auto Filter"]
                ),
                track(TrackKind::Midi, "3 Lead", 20, &["Simpler", "EQ Eight"]),
                track(TrackKind::Return, "A Reverb", 21, &["Reverb"]),
                track(TrackKind::Group, "DRUMS", 22, &[]),
            ]
        );
        assert_eq!(structure.truncated, None);
        // A structure built entirely from Live's own devices names no plugins.
        assert_eq!(structure.plugins, None);
    }

    #[test]
    fn reads_which_group_each_track_belongs_to_groups_inside_groups_included() {
        let member = |kind: &str, id: u32, name: &str, group: i64| {
            format!(
                r#"<{kind} Id="{id}">{}{}{}</{kind}>"#,
                named(name),
                in_group(group),
                chain("")
            )
        };
        let doc = live_set(&format!(
            "{}{}{}{}{}",
            member("AudioTrack", 19, "Kick", -1),
            member("GroupTrack", 73, "DRUMS", -1),
            member("AudioTrack", 74, "Snare", 73),
            member("GroupTrack", 107, "PERC", 73),
            member("AudioTrack", 106, "Shaker", 107),
        ));

        let groups: Vec<_> = tracks(&doc)
            .into_iter()
            .map(|t| (t.name, t.id, t.group_id))
            .collect();
        assert_eq!(
            groups,
            [
                ("Kick".to_string(), Some(19), None),
                ("DRUMS".to_string(), Some(73), None),
                ("Snare".to_string(), Some(74), Some(73)),
                ("PERC".to_string(), Some(107), Some(73)),
                ("Shaker".to_string(), Some(106), Some(107)),
            ]
        );
    }

    #[test]
    fn ignores_a_track_group_id_that_is_not_the_tracks_own_direct_child() {
        // The element repeats deeper in a track in other contexts; only the one
        // Live writes beside <Name> says which group the track sits in.
        let doc = live_set(&format!(
            r#"<AudioTrack Id="19">{}{}<DeviceChain><Mixer Id="1">{}</Mixer></DeviceChain></AudioTrack>"#,
            named("Kick"),
            in_group(-1),
            in_group(73),
        ));

        assert_eq!(tracks(&doc)[0].group_id, None);
    }

    #[test]
    fn names_third_party_plugins_from_their_vst3_and_au_info_blocks() {
        let doc = live_set(&format!(
            r#"<MidiTrack Id="1">{}{}</MidiTrack>"#,
            named("Bass"),
            chain(
                r#"
        <PluginDevice Id="10">
          <PluginDesc>
            <Vst3PluginInfo>
              <Name Value="Serum 2" />
              <Manufacturer Value="Xfer Records" />
            </Vst3PluginInfo>
          </PluginDesc>
        </PluginDevice>
        <AuPluginDevice Id="11">
          <PluginDesc>
            <AuPluginInfo>
              <Name Value="FabFilter Pro-Q 3" />
              <Manufacturer Value="FabFilter" />
            </AuPluginInfo>
          </PluginDesc>
        </AuPluginDevice>
        <VstPluginDevice Id="12">
          <PluginDesc>
            <VstPluginInfo>
              <PlugName Value="Valhalla VintageVerb" />
            </VstPluginInfo>
          </PluginDesc>
        </VstPluginDevice>"#
            ),
        ));
        let structure = structure(&doc);

        assert_eq!(
            structure.tracks[0].devices,
            ["Serum 2", "FabFilter Pro-Q 3", "Valhalla VintageVerb"]
        );
        let plugin = |host: &str, manufacturer: Option<&str>| PluginInfo {
            host: host.to_string(),
            manufacturer: manufacturer.map(str::to_string),
        };
        assert_eq!(
            structure.plugins,
            Some(
                [
                    ("Serum 2".to_string(), plugin("vst3", Some("Xfer Records"))),
                    (
                        "FabFilter Pro-Q 3".to_string(),
                        plugin("au", Some("FabFilter"))
                    ),
                    ("Valhalla VintageVerb".to_string(), plugin("vst", None)),
                ]
                .into()
            )
        );
    }

    #[test]
    fn ignores_a_presets_own_name_nested_inside_a_plugin_info_block() {
        let doc = live_set(&format!(
            r#"<MidiTrack Id="1">{}{}</MidiTrack>"#,
            named("Bass"),
            chain(
                r#"
        <PluginDevice Id="10">
          <PluginDesc>
            <Vst3PluginInfo>
              <Name Value="Serum 2" />
              <Preset>
                <Vst3Preset Id="0">
                  <Name Value="Init Saw" />
                </Vst3Preset>
              </Preset>
              <Manufacturer Value="Xfer Records" />
            </Vst3PluginInfo>
          </PluginDesc>
        </PluginDevice>"#
            ),
        ));
        let structure = structure(&doc);

        assert_eq!(structure.tracks[0].devices, ["Serum 2"]);
        assert_eq!(
            structure.plugins,
            Some(
                [(
                    "Serum 2".to_string(),
                    PluginInfo {
                        host: "vst3".to_string(),
                        manufacturer: Some("Xfer Records".to_string()),
                    }
                )]
                .into()
            )
        );
    }

    #[test]
    fn drops_a_plugin_whose_info_block_never_names_it() {
        let doc = live_set(&format!(
            r#"<MidiTrack Id="1">{}{}</MidiTrack>"#,
            named("Bass"),
            chain(r#"<PluginDevice Id="10" /><Reverb Id="11" />"#),
        ));
        let structure = structure(&doc);

        assert_eq!(structure.tracks[0].devices, ["Reverb"]);
        assert_eq!(structure.plugins, None);
    }

    #[test]
    fn lists_a_rack_once_and_never_its_branch_devices() {
        let doc = live_set(&format!(
            r#"<MidiTrack Id="1">{}{}</MidiTrack>"#,
            named("Drums"),
            chain(&format!(
                r#"
        <DrumGroupDevice Id="10">
          <Branches>
            <DrumBranch Id="0">{}</DrumBranch>
            <DrumBranch Id="1">{}</DrumBranch>
          </Branches>
        </DrumGroupDevice>
        <Compressor2 Id="11" />"#,
                chain(r#"<OriginalSimpler Id="20" /><Saturator Id="21" />"#),
                chain(r#"<OriginalSimpler Id="22" />"#),
            )),
        ));

        assert_eq!(tracks(&doc)[0].devices, ["Drum Rack", "Compressor"]);
    }

    #[test]
    fn records_no_devices_for_a_chain_live_wrote_as_an_empty_element() {
        // An empty chain is a self-closing <Devices />, which has no closing tag
        // to end it: the clip slots and mixer targets after it are not devices.
        let doc = live_set(&format!(
            r#"
      <GroupTrack Id="86">{}
        <DeviceChain>
          <DeviceChain><Devices /></DeviceChain>
          <MainSequencer><ClipSlotList><ClipSlot Id="0" /></ClipSlotList></MainSequencer>
          <Mixer><On><AutomationTarget Id="5" /></On></Mixer>
        </DeviceChain>
      </GroupTrack>
      <AudioTrack Id="87">{}{}</AudioTrack>"#,
            named("Fx"),
            named("Noise"),
            chain(r#"<Reverb Id="1" />"#),
        ));

        let devices: Vec<_> = tracks(&doc).into_iter().map(|t| t.devices).collect();
        assert_eq!(devices, [Vec::<String>::new(), vec!["Reverb".to_string()]]);
    }

    #[test]
    fn reads_each_tracks_colour_from_its_index_into_lives_palette() {
        let doc = live_set(&format!(
            r#"
      <AudioTrack Id="1">{}{}{}</AudioTrack>
      <GroupTrack Id="2">{}{}{}</GroupTrack>
      <ReturnTrack Id="3">{}{}{}</ReturnTrack>"#,
            named("Kick"),
            colour("Color", 14),
            chain(""),
            named("DRUMS"),
            colour("Color", 0),
            chain(""),
            named("A Reverb"),
            colour("Color", 69),
            chain(""),
        ));

        assert_eq!(
            colours(&doc),
            [some("#ff3636"), some("#ff94a6"), some("#3c3c3c")]
        );
    }

    #[test]
    fn takes_the_tracks_own_colour_never_a_clips_inside_it() {
        let clip = |index: i64| {
            format!(
                r#"<DeviceChain><MainSequencer><ClipSlotList><ClipSlot Id="0"><AudioClip Id="0">{}</AudioClip></ClipSlot></ClipSlotList></MainSequencer></DeviceChain>"#,
                colour("Color", index)
            )
        };
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1">{}{}{}</AudioTrack><AudioTrack Id="2">{}{}</AudioTrack>"#,
            named("Vox"),
            colour("Color", 14),
            clip(20),
            named("Pad"),
            clip(20),
        ));

        assert_eq!(colours(&doc), [some("#ff3636"), None]);
    }

    #[test]
    fn leaves_a_track_uncoloured_when_its_index_is_outside_the_palette() {
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1">{}{}{}</AudioTrack><AudioTrack Id="2">{}{}{}</AudioTrack>"#,
            named("Kick"),
            colour("Color", 70),
            chain(""),
            named("Snare"),
            colour("Color", -1),
            chain(""),
        ));

        assert_eq!(colours(&doc), [None, None]);
    }

    #[test]
    fn reads_live_10_track_colours_from_the_shifted_numbering_it_writes_them_in() {
        let doc = live_set_by(
            &format!(
                r#"
      <AudioTrack Id="1">{}{}{}</AudioTrack>
      <AudioTrack Id="2">{}{}{}</AudioTrack>
      <AudioTrack Id="3">{}{}{}</AudioTrack>"#,
                named("Kick"),
                colour("ColorIndex", 154),
                chain(""),
                named("Snare"),
                colour("ColorIndex", 287),
                chain(""),
                named("Hat"),
                colour("ColorIndex", 0),
                chain(""),
            ),
            "Ableton Live 10.1.30",
        );

        assert_eq!(colours(&doc), [some("#ff3636"), some("#3c3c3c"), None]);
    }

    #[test]
    fn leaves_a_live_9_set_uncoloured_since_its_palette_is_not_live_10s() {
        let doc = live_set_by(
            &format!(
                r#"<AudioTrack Id="1">{}{}{}</AudioTrack>"#,
                named("Kick"),
                colour("ColorIndex", 154),
                chain(""),
            ),
            "Ableton Live 9.7.7",
        );

        assert_eq!(colours(&doc), [None]);
    }

    #[test]
    fn reads_the_live_version_from_minor_version_when_creator_is_absent() {
        let doc = format!(
            r#"<Ableton MinorVersion="10.0_10049"><LiveSet><Tracks><AudioTrack Id="1">{}{}</AudioTrack></Tracks></LiveSet></Ableton>"#,
            named("Kick"),
            colour("ColorIndex", 154),
        );

        assert_eq!(colours(&doc), [some("#ff3636")]);
    }

    #[test]
    fn counts_audio_and_midi_clips_across_every_track() {
        let doc = live_set(&format!(
            r#"
      <AudioTrack Id="1">{}
        <DeviceChain><MainSequencer><ClipSlotList>
          <ClipSlot Id="0"><AudioClip Id="0" /></ClipSlot>
          <ClipSlot Id="1"><AudioClip Id="1" /></ClipSlot>
        </ClipSlotList></MainSequencer></DeviceChain>
      </AudioTrack>
      <MidiTrack Id="2">{}
        <DeviceChain><MainSequencer><ClipSlotList>
          <ClipSlot Id="0"><MidiClip Id="2" /></ClipSlot>
          <ClipSlot Id="1"><MidiClip /></ClipSlot>
        </ClipSlotList></MainSequencer></DeviceChain>
      </MidiTrack>"#,
            named("Vox"),
            named("Keys"),
        ));

        assert_eq!(
            structure(&doc).clips,
            Some(ClipCounts { audio: 2, midi: 1 })
        );
    }

    #[test]
    fn a_set_with_tracks_but_no_clips_counts_zero_of_each() {
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1">{}{}</AudioTrack>"#,
            named("Kick"),
            chain("")
        ));

        assert_eq!(
            structure(&doc).clips,
            Some(ClipCounts { audio: 0, midi: 0 })
        );
    }

    #[test]
    fn fills_clips_and_scenes_on_a_set_with_both() {
        let doc = format!(
            r#"<Ableton Creator="Ableton Live 12.3"><LiveSet>
  <Tracks><MidiTrack Id="1">{}<ClipSlot Id="0"><MidiClip Id="0" /></ClipSlot></MidiTrack></Tracks>
  <Scenes><Scene Id="0" /><Scene Id="1" /><Scene Id="2" /></Scenes>
</LiveSet></Ableton>"#,
            named("Keys")
        );
        let meta = meta(&doc);
        let structure = meta.structure.expect("a structure");

        assert_eq!(structure.clips, Some(ClipCounts { audio: 0, midi: 1 }));
        assert_eq!(structure.scenes, Some(3));
        assert_eq!(structure.scenes, meta.scenes_count);
    }

    #[test]
    fn takes_the_scene_count_from_scene_names_when_there_are_no_scenes() {
        let doc = format!(
            r#"<Ableton><LiveSet>
  <Tracks><MidiTrack Id="1">{}</MidiTrack></Tracks>
  <SceneNames><Scene Value="a" /><Scene Value="b" /></SceneNames>
</LiveSet></Ableton>"#,
            named("Keys")
        );

        assert_eq!(structure(&doc).scenes, Some(2));
    }

    #[test]
    fn ignores_the_routing_lists_and_frozen_copies_that_repeat_track_elements() {
        let noise = format!(
            r#"
        <AvailableInputRoutingTypes>
          <RoutingType><Target Value="AudioTrack.7" /></RoutingType>
        </AvailableInputRoutingTypes>
        <FreezeToOriginalTracksData>
          <AudioTrack Id="900">{}{}</AudioTrack>
        </FreezeToOriginalTracksData>"#,
            named("frozen"),
            chain(r#"<Reverb Id="99" />"#),
        );
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1">{}<DeviceChain>{noise}</DeviceChain>{}</AudioTrack>"#,
            named("Real"),
            chain(r#"<Saturator Id="2" />"#),
        ));
        let tracks = tracks(&doc);

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].name, "Real");
    }

    #[test]
    fn a_self_closing_track_has_no_entry() {
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1" /><MidiTrack Id="2">{}</MidiTrack>"#,
            named("Keys")
        ));
        let tracks = tracks(&doc);

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].name, "Keys");
    }

    #[test]
    fn a_track_with_no_id_or_name_still_has_an_entry() {
        let doc = live_set(&format!("<AudioTrack>{}</AudioTrack>", chain("")));

        assert_eq!(
            tracks(&doc),
            [StructureTrack {
                kind: TrackKind::Audio,
                name: String::new(),
                devices: vec![],
                id: None,
                group_id: None,
                color: None,
            }]
        );
    }

    #[test]
    fn reads_names_with_their_entities_decoded() {
        let doc = live_set(&format!(
            r#"<AudioTrack Id="1">{}</AudioTrack>"#,
            named("Drums &amp; Bass")
        ));

        assert_eq!(tracks(&doc)[0].name, "Drums & Bass");
    }

    #[test]
    fn caps_the_track_and_device_lists_and_flags_the_structure_as_truncated() {
        let devices: String = (0..80).map(|i| format!(r#"<Reverb Id="{i}" />"#)).collect();
        let doc = live_set(
            &(0..300)
                .map(|i| {
                    let devices = if i == 0 { devices.as_str() } else { "" };
                    format!(
                        r#"<AudioTrack Id="{i}">{}{}</AudioTrack>"#,
                        named(&format!("T{i}")),
                        chain(devices)
                    )
                })
                .collect::<String>(),
        );
        let meta = meta(&doc);
        let structure = meta.structure.expect("a structure");

        assert_eq!(structure.tracks.len(), 256);
        assert_eq!(structure.tracks[0].devices.len(), 64);
        assert_eq!(structure.truncated, Some(true));
        // The counters are unaffected by the structure's caps.
        assert_eq!(meta.tracks_count, Some(300));
    }

    #[test]
    fn a_track_cut_by_the_cap_adds_no_clips_or_plugins() {
        let plugin = r#"<PluginDevice Id="1"><Vst3PluginInfo><Name Value="Late" /></Vst3PluginInfo></PluginDevice>"#;
        let clip = r#"<MidiClip Id="9" />"#;
        let doc = live_set(
            &(0..257)
                .map(|i| {
                    let extra = if i == 256 {
                        format!("{}{clip}", chain(plugin))
                    } else {
                        String::new()
                    };
                    format!(r#"<MidiTrack Id="{i}">{}{extra}</MidiTrack>"#, named("T"))
                })
                .collect::<String>(),
        );
        let structure = structure(&doc);

        assert_eq!(structure.tracks.len(), 256);
        assert_eq!(structure.truncated, Some(true));
        assert_eq!(structure.plugins, None);
        assert_eq!(structure.clips, Some(ClipCounts { audio: 0, midi: 0 }));
    }

    #[test]
    fn a_self_closing_track_past_the_cap_does_not_truncate() {
        let doc = live_set(&format!(
            "{}<AudioTrack Id=\"999\" />",
            (0..256)
                .map(|i| format!(r#"<AudioTrack Id="{i}">{}</AudioTrack>"#, named("T")))
                .collect::<String>()
        ));

        assert_eq!(structure(&doc).truncated, None);
    }

    #[test]
    fn omits_the_structure_for_a_set_with_no_tracks() {
        assert_eq!(meta(&live_set("")).structure, None);
        assert_eq!(meta(r#"<Ableton><LiveSet/></Ableton>"#).structure, None);
        assert_eq!(meta(&live_set(r#"<AudioTrack Id="1" />"#)).structure, None);
    }
}
