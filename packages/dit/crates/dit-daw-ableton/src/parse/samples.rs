//! The samples a set references, one path per distinct file, in document order.

use std::collections::HashSet;

use dit_core::{SampleKind, SampleRef as Reference, SetMeta};

use super::{Path, Tag, Visitor};

/// How many distinct sample paths a set's meta carries.
const MAX_SAMPLE_PATHS: usize = 500;

/// What one `<SampleRef>` says about its file.
#[derive(Default)]
struct SampleRef {
    path: Option<String>,
    relative_path: Option<String>,
    name: Option<String>,
    relative_path_type: Option<String>,
    has_relative_path: Option<String>,
    /// The `Dir` of each `<RelativePathElement>` of a Live 10 relative path.
    dirs: Vec<String>,
}

#[derive(Default)]
pub(super) struct Samples {
    /// Depth of the `<SampleRef>` being read, `None` outside one.
    open_at: Option<usize>,
    current: SampleRef,
    /// Every distinct ref, by path, in document order.
    refs: Vec<Reference>,
    seen: HashSet<String>,
}

impl Visitor for Samples {
    fn start(&mut self, path: &Path, tag: &Tag) {
        let Some(open_at) = self.open_at else {
            if path.at(path.depth() - 1) == Some("SampleRef") {
                self.open_at = Some(path.depth());
                self.current = SampleRef::default();
            }
            return;
        };
        // Only the ref's own `<FileRef>` says where its file is; a
        // `<SourceContext>` further in describes the file it was made from.
        if path.at(open_at) != Some("FileRef") {
            return;
        }
        let current = &mut self.current;
        match path.depth() - open_at {
            2 => match path.at(open_at + 1) {
                Some("Path") => set_once(&mut current.path, tag),
                Some("RelativePath") => set_once(&mut current.relative_path, tag),
                Some("Name") => set_once(&mut current.name, tag),
                Some("RelativePathType") => set_once(&mut current.relative_path_type, tag),
                Some("HasRelativePath") => set_once(&mut current.has_relative_path, tag),
                _ => {}
            },
            3 if path.at(open_at + 1) == Some("RelativePath")
                && path.at(open_at + 2) == Some("RelativePathElement") =>
            {
                current.dirs.push(tag.attr("Dir").unwrap_or_default());
            }
            _ => {}
        }
    }

    fn end(&mut self, path: &Path) {
        if self.open_at != Some(path.depth()) {
            return;
        }
        self.open_at = None;
        if let Some(reference) = std::mem::take(&mut self.current).reference()
            && self.seen.insert(reference.path.clone())
        {
            self.refs.push(reference);
        }
    }
}

impl Samples {
    pub(super) fn fill(self, meta: &mut SetMeta) {
        meta.sample_paths = Some(
            self.refs
                .into_iter()
                .take(MAX_SAMPLE_PATHS)
                .map(|reference| reference.path)
                .collect(),
        );
    }

    pub(super) fn into_refs(self) -> Vec<Reference> {
        self.refs
    }
}

fn set_once(slot: &mut Option<String>, tag: &Tag) {
    if slot.is_none() {
        *slot = tag.attr("Value");
    }
}

impl SampleRef {
    /// The reference this ref makes. Its path is the absolute `Path`, else the `RelativePath`, else (a Live 10 ref)
    /// the relative path its elements spell, else the `Name`; `None` when the ref names nothing. Its kind is the one
    /// its `RelativePathType` gives (3 project, 5 and 6 library, anything else outside) and, for a project ref, it
    /// carries the relative path.
    fn reference(&self) -> Option<Reference> {
        let non_empty = |value: &Option<String>| value.clone().filter(|value| !value.is_empty());
        let name = non_empty(&self.name);
        let relative = non_empty(&self.relative_path)
            .or_else(|| name.as_deref().and_then(|name| self.element_path(name)));
        let path = non_empty(&self.path)
            .or_else(|| relative.clone())
            .or(name)?;
        let kind = match self.relative_path_type.as_deref() {
            Some("3") => SampleKind::Project,
            Some("5" | "6") => SampleKind::Library,
            _ => SampleKind::Outside,
        };
        Some(Reference {
            path,
            kind,
            relative: relative.filter(|_| kind == SampleKind::Project),
            object: None,
            size: None,
        })
    }

    /// The relative path a Live 10 ref spells out as
    /// `<RelativePath><RelativePathElement Dir="…"/>…</RelativePath>` beside its
    /// `<Name>`, when it says the file is inside the project folder
    /// (`HasRelativePath` true, `RelativePathType` 3). `None` when it does not
    /// say where the file is: a directory step Live writes empty (a step up),
    /// or any other type.
    fn element_path(&self, name: &str) -> Option<String> {
        if self.relative_path_type.as_deref() != Some("3")
            || !self
                .has_relative_path
                .as_deref()
                .is_some_and(|flag| flag.eq_ignore_ascii_case("true"))
            || self.dirs.iter().any(String::is_empty)
        {
            return None;
        }
        let mut parts: Vec<&str> = self.dirs.iter().map(String::as_str).collect();
        parts.push(name);
        Some(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use crate::parse::parse;

    /// A set holding `body` inside its `<Tracks>`, and the paths it reads.
    fn sample_paths(body: &str) -> Vec<String> {
        let doc = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="Ableton Live 12.3">
  <LiveSet>
    <Tracks>
      <AudioTrack Id="1" />
      {body}
    </Tracks>
    <Scenes><Scene Id="0" /></Scenes>
  </LiveSet>
</Ableton>"#
        );
        parse(doc.as_bytes()).unwrap().sample_paths.unwrap()
    }

    /// A short one-line ref, `type` being its RelativePathType when given.
    fn short_ref(path: &str, relative_type: Option<u32>) -> String {
        let relative_type = relative_type
            .map(|kind| format!(r#"<RelativePathType Value="{kind}" />"#))
            .unwrap_or_default();
        format!(
            r#"<SampleRef><FileRef>{relative_type}<Path Value="{path}" /></FileRef></SampleRef>"#
        )
    }

    /// A ref shaped like Live 12.3 writes it: multi-line, with the file's own
    /// `<FileRef>` followed by a `<SourceContext>` that repeats a file
    /// reference and carries a long binary `<Data>` block.
    fn long_ref() -> String {
        let data = "0A1B2C3D4E5F".repeat(120);
        format!(
            r#"<SampleRef>
        <FileRef>
          <HasRelativePath Value="true" />
          <RelativePathType Value="3" />
          <RelativePath Value="Samples/Imported/kick-soft-04.wav" />
          <Name Value="kick-soft-04.wav" />
          <Type Value="1" />
          <Data>{data}</Data>
          <Path Value="/Users/demo/Music/Glass Harbour Project/Samples/Imported/kick-soft-04.wav" />
        </FileRef>
        <LastModDate Value="1700000000" />
        <SourceContext>
          <SourceContext Id="0">
            <OriginalFileRef>
              <FileRef>
                <HasRelativePath Value="false" />
                <RelativePathType Value="1" />
                <Name Value="kick-soft-original.wav" />
                <Type Value="1" />
                <Data>{data}</Data>
                <Path Value="/Users/demo/Downloads/kick-soft-original.wav" />
              </FileRef>
            </OriginalFileRef>
            <BrowserContentPath Value="query:UserLibrary#Samples:Imported:kick-soft-04.wav" />
          </SourceContext>
        </SourceContext>
        <SampleUsageHint Value="0" />
      </SampleRef>"#
        )
    }

    #[test]
    fn reads_a_live_12_ref_that_runs_far_past_a_thousand_characters() {
        let ref_ = long_ref();
        assert!(ref_.len() > 1700);
        assert_eq!(
            sample_paths(&ref_),
            ["/Users/demo/Music/Glass Harbour Project/Samples/Imported/kick-soft-04.wav"]
        );
    }

    #[test]
    fn a_source_context_never_stands_in_for_the_refs_own_file() {
        let ref_ = r#"<SampleRef><FileRef><Type Value="1"/></FileRef>
            <SourceContext><SourceContext Id="0"><OriginalFileRef><FileRef>
              <Path Value="/Users/demo/Downloads/original.wav"/>
            </FileRef></OriginalFileRef></SourceContext></SourceContext></SampleRef>"#;
        assert_eq!(sample_paths(ref_), Vec::<String>::new());
    }

    #[test]
    fn reads_every_relative_path_type_the_same() {
        let refs = [
            short_ref("/s/project.wav", Some(3)),
            short_ref("/s/outside.wav", Some(1)),
            short_ref("/s/library-5.wav", Some(5)),
            short_ref("/s/library-6.wav", Some(6)),
            short_ref("/s/unknown.wav", Some(2)),
            short_ref("/s/absent.wav", None),
        ]
        .join("\n      ");
        assert_eq!(
            sample_paths(&refs),
            [
                "/s/project.wav",
                "/s/outside.wav",
                "/s/library-5.wav",
                "/s/library-6.wav",
                "/s/unknown.wav",
                "/s/absent.wav"
            ]
        );
    }

    #[test]
    fn falls_back_from_path_to_relative_path_to_name() {
        let refs = format!(
            r#"
      <SampleRef><FileRef><RelativePathType Value="3" /><RelativePath Value="Samples/Imported/rel.wav" /><Name Value="rel.wav" /></FileRef></SampleRef>
      <SampleRef><FileRef><Name Value="only-name.wav" /></FileRef></SampleRef>
      {}"#,
            short_ref("/s/absolute-only.wav", None)
        );
        assert_eq!(
            sample_paths(&refs),
            [
                "Samples/Imported/rel.wav",
                "only-name.wav",
                "/s/absolute-only.wav"
            ]
        );
    }

    #[test]
    fn the_absolute_path_wins_over_the_relative_one_and_the_name() {
        let ref_ = r#"<SampleRef><FileRef>
            <Name Value="a.wav"/><RelativePath Value="Samples/a.wav"/><Path Value="/s/a.wav"/>
        </FileRef></SampleRef>"#;
        assert_eq!(sample_paths(ref_), ["/s/a.wav"]);
    }

    #[test]
    fn an_empty_path_falls_through_to_the_next_candidate() {
        let ref_ = r#"<SampleRef><FileRef><Path Value=""/><RelativePath Value=""/><Name Value="n.wav"/></FileRef></SampleRef>"#;
        assert_eq!(sample_paths(ref_), ["n.wav"]);
    }

    #[test]
    fn reads_a_live_10_refs_path_elements_as_its_project_relative_path() {
        let live_10_ref = |name: &str, dirs: &[&str], relative_type: u32, has_relative: bool| {
            let elements: String = dirs
                .iter()
                .enumerate()
                .map(|(i, dir)| format!(r#"<RelativePathElement Id="{i}" Dir="{dir}" />"#))
                .collect();
            format!(
                r#"
      <SampleRef><FileRef>
        <HasRelativePath Value="{has_relative}" />
        <RelativePathType Value="{relative_type}" />
        <RelativePath>{elements}</RelativePath>
        <Name Value="{name}" />
        <SearchHint><PathHint><RelativePathElement Id="0" Dir="Users" /><RelativePathElement Id="1" Dir="someone" /></PathHint></SearchHint>
      </FileRef></SampleRef>"#
            )
        };
        let refs = [
            live_10_ref("kick.wav", &["Samples", "Imported"], 3, true),
            live_10_ref("root.wav", &[], 3, true),
            live_10_ref("up.wav", &["", "Shared"], 3, true),
            live_10_ref("elsewhere.wav", &["Samples"], 1, true),
            live_10_ref("no-flag.wav", &["Samples"], 3, false),
        ]
        .concat();
        // A ref that does not say where its file is still names it, so its
        // name is the path.
        assert_eq!(
            sample_paths(&refs),
            [
                "Samples/Imported/kick.wav",
                "root.wav",
                "up.wav",
                "elsewhere.wav",
                "no-flag.wav"
            ]
        );
    }

    #[test]
    fn does_not_let_a_neighbouring_refs_fields_leak_into_a_ref_that_lacks_them() {
        let refs = [
            short_ref("/s/typed.wav", Some(5)),
            r#"<SampleRef><FileRef><Path Value="/s/untyped.wav" /></FileRef></SampleRef>"#
                .to_string(),
            r#"<SampleRef><FileRef><Name Value="bare.wav" /></FileRef></SampleRef>"#.to_string(),
        ]
        .join("\n      ");
        assert_eq!(
            sample_paths(&refs),
            ["/s/typed.wav", "/s/untyped.wav", "bare.wav"]
        );
    }

    #[test]
    fn reports_one_sample_per_path_in_document_order() {
        let refs = [
            r#"<SampleRef><FileRef><RelativePathType Value="3" /><RelativePath Value="Samples/a.wav" /><Path Value="/s/a.wav" /></FileRef></SampleRef>"#
                .to_string(),
            short_ref("/s/b.wav", None),
            short_ref("/s/a.wav", Some(1)),
        ]
        .join("\n      ");
        assert_eq!(sample_paths(&refs), ["/s/a.wav", "/s/b.wav"]);
    }

    #[test]
    fn keeps_the_first_five_hundred_samples() {
        let refs = (0..510)
            .map(|i| short_ref(&format!("/Users/producer/Samples/s{i}.wav"), None))
            .collect::<Vec<_>>()
            .join("\n      ");
        let paths = sample_paths(&refs);
        assert_eq!(paths.len(), 500);
        assert_eq!(paths[0], "/Users/producer/Samples/s0.wav");
        assert_eq!(paths[499], "/Users/producer/Samples/s499.wav");
    }

    #[test]
    fn a_repeated_path_takes_one_of_the_five_hundred() {
        let refs = (0..600)
            .map(|i| short_ref(&format!("/s/s{}.wav", i % 300), None))
            .collect::<Vec<_>>()
            .join("");
        assert_eq!(sample_paths(&refs).len(), 300);
    }

    #[test]
    fn decodes_entities_in_a_path_and_leaves_an_impossible_reference_as_written() {
        let refs = [
            short_ref(
                "/Music/Drums &amp; Bass/kick&#x2019;s &#38; snare.wav",
                None,
            ),
            short_ref("/Music/broken&#1114112;.wav", None),
        ]
        .join("");
        assert_eq!(
            sample_paths(&refs),
            [
                "/Music/Drums & Bass/kick\u{2019}s & snare.wav",
                "/Music/broken&#1114112;.wav"
            ]
        );
    }

    #[test]
    fn a_ref_is_read_wherever_it_sits_in_the_set() {
        let doc = r#"<Ableton><LiveSet><Tracks><AudioTrack><DeviceChain><Devices><OriginalSimpler><Player><MultiSampleMap><SampleParts><MultiSamplePart>
            <SampleRef><FileRef><Path Value="/s/deep.wav"/></FileRef></SampleRef>
        </MultiSamplePart></SampleParts></MultiSampleMap></Player></OriginalSimpler></Devices></DeviceChain></AudioTrack></Tracks></LiveSet></Ableton>"#;
        assert_eq!(
            parse(doc.as_bytes()).unwrap().sample_paths,
            Some(vec!["/s/deep.wav".to_string()])
        );
    }

    #[test]
    fn a_set_that_references_no_samples_has_an_empty_list_not_null() {
        assert_eq!(sample_paths(""), Vec::<String>::new());
    }

    #[test]
    fn a_self_closing_sample_ref_names_nothing() {
        assert_eq!(sample_paths("<SampleRef/>"), Vec::<String>::new());
    }

    mod references {
        use dit_core::SampleKind;

        use crate::parse::sample_refs;

        fn refs(body: &str) -> Vec<dit_core::SampleRef> {
            let doc = format!(
                r#"<Ableton MajorVersion="5" Creator="Ableton Live 12.3"><LiveSet><Tracks>{body}</Tracks></LiveSet></Ableton>"#
            );
            sample_refs(doc.as_bytes()).unwrap()
        }

        fn file_ref(kind: u32, fields: &str) -> String {
            format!(
                r#"<SampleRef><FileRef><RelativePathType Value="{kind}" />{fields}</FileRef></SampleRef>"#
            )
        }

        #[test]
        fn kind_follows_the_relative_path_type() {
            let body = [
                file_ref(3, r#"<RelativePath Value="Samples/a.wav" />"#),
                file_ref(1, r#"<Path Value="/x/b.wav" />"#),
                file_ref(5, r#"<Path Value="/lib/c.wav" />"#),
                file_ref(6, r#"<Path Value="/lib/d.wav" />"#),
                file_ref(9, r#"<Path Value="/x/e.wav" />"#),
            ]
            .concat();
            let kinds: Vec<_> = refs(&body).iter().map(|r| r.kind).collect();
            assert_eq!(
                kinds,
                [
                    SampleKind::Project,
                    SampleKind::Outside,
                    SampleKind::Library,
                    SampleKind::Library,
                    SampleKind::Outside
                ]
            );
        }

        #[test]
        fn a_project_ref_keeps_its_relative_path_beside_the_absolute_one() {
            let found = refs(&file_ref(
                3,
                r#"<RelativePath Value="Samples/Imported/k.wav" /><Path Value="/Users/d/P/Samples/Imported/k.wav" />"#,
            ));
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].path, "/Users/d/P/Samples/Imported/k.wav");
            assert_eq!(found[0].relative.as_deref(), Some("Samples/Imported/k.wav"));
            assert_eq!((found[0].object, found[0].size), (None, None));
        }

        #[test]
        fn a_live_10_ref_spells_its_relative_path_from_its_elements() {
            let found = refs(&file_ref(
                3,
                r#"<HasRelativePath Value="true" /><RelativePath><RelativePathElement Dir="Samples" /><RelativePathElement Dir="Imported" /></RelativePath><Name Value="k.wav" />"#,
            ));
            assert_eq!(found[0].path, "Samples/Imported/k.wav");
            assert_eq!(found[0].relative.as_deref(), Some("Samples/Imported/k.wav"));
        }

        #[test]
        fn only_a_project_ref_has_a_relative_path_and_none_is_capped() {
            let mut body = file_ref(
                1,
                r#"<RelativePath Value="Samples/x.wav" /><Path Value="/o/x.wav" />"#,
            );
            for n in 0..600 {
                body.push_str(&file_ref(1, &format!(r#"<Path Value="/o/{n}.wav" />"#)));
            }
            let found = refs(&body);
            assert_eq!(found.len(), 601);
            assert!(found.iter().all(|r| r.relative.is_none()));
        }

        #[test]
        fn a_path_is_listed_once() {
            let one = file_ref(1, r#"<Path Value="/o/x.wav" />"#);
            assert_eq!(refs(&format!("{one}{one}")).len(), 1);
        }
    }
}
