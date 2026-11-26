//! What dit reads out of a set: the JSON the server stores as a revision's
//! meta, field for field.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::store::ObjectId;

/// A track's kind as the DAW reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Audio,
    Midi,
    Return,
    Group,
    Master,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureTrack {
    pub kind: TrackKind,
    pub name: String,
    pub devices: Vec<String>,
    /// The DAW's own id for the track, so a grouped track can name its parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    /// The `id` of the group track this one sits in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<i64>,
    /// `#rrggbb`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipCounts {
    pub audio: i64,
    pub midi: i64,
}

/// A third-party device: the plugin format that hosts it and who made it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginInfo {
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetStructure {
    pub tracks: Vec<StructureTrack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clips: Option<ClipCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenes: Option<i64>,
    /// Keyed by display name; a `BTreeMap` so the serialised bytes are deterministic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins: Option<BTreeMap<String, PluginInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

/// Where a sample a set references lives, as the DAW says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleKind {
    /// Inside the project folder.
    Project,
    /// Elsewhere on the disk.
    Outside,
    /// In the DAW's library.
    Library,
}

/// One sample a set references.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRef {
    /// As the set writes it, absolute or relative.
    pub path: String,
    pub kind: SampleKind,
    /// The path from the project folder, only for a `Project` sample under
    /// `Samples/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative: Option<String>,
    /// The Blob or Chunked leaf holding the file, when it is tracked and was
    /// read.
    #[serde(default)]
    pub object: Option<ObjectId>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMeta {
    pub tempo: Option<String>,
    pub time_signature: Option<String>,
    pub root_note: Option<String>,
    pub scale: Option<String>,
    pub tracks_count: Option<i64>,
    pub scenes_count: Option<i64>,
    pub daw_version: Option<String>,
    pub sample_paths: Option<Vec<String>>,
    pub structure: Option<SetStructure>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn a_full_revision_meta_round_trips_to_equal_json() {
        let json = json!({
            "tempo": "128",
            "timeSignature": "4/4",
            "rootNote": "F",
            "scale": "Minor",
            "tracksCount": 4,
            "scenesCount": 8,
            "dawVersion": "12.1",
            "samplePaths": null,
            "structure": {
                "tracks": [
                    { "id": 1, "kind": "group", "name": "61 DRUMS", "devices": ["Glue Compressor"], "color": "#ff94a6" },
                    { "id": 2, "groupId": 1, "kind": "audio", "name": "Kick", "devices": ["EQ Eight"], "color": "#ff94a6" },
                    { "id": 3, "groupId": 1, "kind": "midi", "name": "Kick Sub", "devices": [] },
                    { "id": 40, "kind": "return", "name": "B-Shimmery Verb", "devices": ["EQ Eight", "ValhallaShimmer"], "color": "#a9a9a9" },
                    { "id": 41, "kind": "master", "name": "Master", "devices": ["Limiter"], "color": "#3c3c3c" }
                ],
                "clips": { "audio": 44, "midi": 61 },
                "scenes": 8,
                "plugins": { "ValhallaShimmer": { "host": "vst3", "manufacturer": "Valhalla DSP" }, "Serum": { "host": "vst3" } },
                "truncated": false
            }
        });
        let meta: SetMeta = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(meta.structure.as_ref().unwrap().tracks[1].group_id, Some(1));
        assert_eq!(serde_json::to_value(&meta).unwrap(), json);
    }

    #[test]
    fn an_all_none_meta_serialises_every_top_level_key_as_null() {
        let value = serde_json::to_value(SetMeta::default()).unwrap();
        let object = value.as_object().unwrap();
        for key in [
            "tempo",
            "timeSignature",
            "rootNote",
            "scale",
            "tracksCount",
            "scenesCount",
            "dawVersion",
            "samplePaths",
            "structure",
        ] {
            assert_eq!(object.get(key), Some(&Value::Null), "{key}");
        }
        assert_eq!(object.len(), 9);
    }

    #[test]
    fn unknown_track_kinds_are_refused() {
        let bad = json!({ "kind": "video", "name": "x", "devices": [] });
        assert!(serde_json::from_value::<StructureTrack>(bad).is_err());
    }
}
