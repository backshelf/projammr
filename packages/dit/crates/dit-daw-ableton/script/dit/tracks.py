"""What the set holds, read from Live's object model into the plain dicts the wire carries.

Pure over duck-typed objects (anything with Live's attribute names), so the tests need no Live.
"""

# Live's device class names that are not Live's own devices.
_PLUGIN_KINDS = {
    "PluginDevice": "vst3",
    "AuPluginDevice": "au",
    "MxDeviceAudioEffect": "m4l",
    "MxDeviceInstrument": "m4l",
    "MxDeviceMidiEffect": "m4l",
    "MxDeviceMidiNoteEffect": "m4l",
}


def device_kind(device):
    return _PLUGIN_KINDS.get(getattr(device, "class_name", ""), "live")


def _track_kind(track, role):
    if role in ("return", "master"):
        return role
    if getattr(track, "is_foldable", False):
        return "group"
    if getattr(track, "has_midi_input", False):
        return "midi"
    return "audio"


def describe_tracks(song):
    """Every track in the order Live shows them (tracks, returns, master) as C5 `tracks` entries.

    `id` is the position in this list; `groupId` is the position of the track's group, or None.
    """
    entries = []
    for role, group in (
        ("track", list(song.tracks)),
        ("return", list(song.return_tracks)),
        ("master", [song.master_track]),
    ):
        for track in group:
            entries.append((role, track))
    objects = [track for _, track in entries]
    described = []
    for index, (role, track) in enumerate(entries):
        parent = getattr(track, "group_track", None)
        group_id = None
        if parent is not None:
            for position, other in enumerate(objects):
                if other == parent:
                    group_id = position
                    break
        described.append(
            {
                "id": index,
                "name": str(track.name),
                "color": getattr(track, "color_index", None),
                "kind": _track_kind(track, role),
                "groupId": group_id,
                "devices": [
                    {"name": str(device.name), "kind": device_kind(device)}
                    for device in track.devices
                ],
            }
        )
    return described
