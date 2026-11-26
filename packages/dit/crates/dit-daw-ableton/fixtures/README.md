# Ableton fixtures

Three Live sets the contract suite (`../../dit-daws/tests/contract.rs`) runs the module over. The first two are copied
byte for byte from the retired scanner's Ableton contract fixtures; the third is
dit's own, because neither of those holds a volatile value or a blob body, so the suite's mask round trip would
prove nothing without it. They sit inside
`Contract Fixtures Project/` because Live puts a set in a folder named `<title> Project`, which is what
`is_project_folder` accepts.

| File               | What it stands for                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Empty Set.als`    | A set as Live creates it: two MIDI and two audio tracks, two returns, eight empty scenes, 120 BPM, 4/4, no clips, no plugins.          |
| `Arranged Set.als` | A set with work in it: a group track with a member, a VST3 plugin, audio and MIDI clips, two sample references, 126 BPM, 6/8, A Minor. |
| `Volatile Set.als` | One audio track carrying the values `mask` takes out (a `FileRef`, `WarpMarker` and `Vst3Preset` `Id`, lane, selection and loop view state, a take counter) and a VST3 preset's `ProcessorState` and `ControllerState` bodies (Blob leaves), 92 BPM, 4/4. |

Neither file came out of Live. Each is XML written by hand to the shape Live writes, then gzipped at level 9 by
another tool, so re-encoding the decoded document does not reproduce the file's bytes. The suite therefore checks
`decode(encode(doc)) == doc` and not a byte-exact re-encode.
