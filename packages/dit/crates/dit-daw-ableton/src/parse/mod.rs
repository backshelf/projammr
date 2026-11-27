//! Reading a set's metadata (`SetMeta`) from its decoded XML.
//!
//! One pass over the document, held whole in memory. `parse` owns the
//! `quick-xml` event loop and the stack of open tags, and hands every element
//! to each reader (`fields`, `samples`) with its path, so a reader only says
//! which paths it wants.

use std::borrow::Cow;

use dit_core::{DawError, SetMeta};
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

mod devices;
mod fields;
pub(crate) mod palette;
mod samples;
mod structure;

pub(crate) use structure::device_display_name;

/// The open tags from the root down to, and including, the element an event
/// is about.
pub(crate) struct Path<'a>(&'a [String]);

impl Path<'_> {
    pub(crate) fn depth(&self) -> usize {
        self.0.len()
    }

    /// The tag at `depth`, 0 being the root element.
    pub(crate) fn at(&self, depth: usize) -> Option<&str> {
        self.0.get(depth).map(String::as_str)
    }

    /// Whether the path is exactly `pattern`, tag for tag. A pattern element
    /// is a tag name, `a|b` for either of two, or `*` for any tag.
    pub(crate) fn is(&self, pattern: &[&str]) -> bool {
        self.0.len() == pattern.len() && self.starts_with(pattern)
    }

    /// Whether the path begins with `pattern`, under the same pattern rules
    /// as [`Path::is`].
    pub(crate) fn starts_with(&self, pattern: &[&str]) -> bool {
        self.0.len() >= pattern.len()
            && self
                .0
                .iter()
                .zip(pattern)
                .all(|(tag, want)| tag_matches(tag, want))
    }
}

fn tag_matches(tag: &str, want: &str) -> bool {
    want == "*" || want.split('|').any(|alternative| alternative == tag)
}

/// The attributes of the element an event is about.
pub(crate) struct Tag<'a>(&'a BytesStart<'a>);

impl Tag<'_> {
    /// The named attribute's value with its character and entity references
    /// decoded, or `None` when the element has no such attribute.
    pub(crate) fn attr(&self, name: &str) -> Option<String> {
        let attribute = self
            .0
            .attributes()
            .filter_map(Result::ok)
            .find(|attribute| attribute.key.as_ref() == name)?;
        Some(decode_entities(&attribute.value).into_owned())
    }
}

/// Something that reads a set's fields off the element stream.
pub(crate) trait Visitor {
    /// An element opened; `path` ends with its tag. An empty element
    /// (`<A/>`) opens and closes.
    fn start(&mut self, path: &Path, tag: &Tag);

    /// An element closed; `path` still ends with its tag.
    fn end(&mut self, _path: &Path) {}
}

pub(crate) fn parse(doc: &[u8]) -> Result<SetMeta, DawError> {
    let mut fields = fields::Fields::default();
    let mut samples = samples::Samples::default();
    let mut structure = structure::Structure::default();
    walk(doc, &mut [&mut fields, &mut samples, &mut structure])?;

    let mut meta = SetMeta::default();
    fields.fill(&mut meta);
    samples.fill(&mut meta);
    structure.fill(&mut meta);
    Ok(meta)
}

pub(crate) fn sample_refs(doc: &[u8]) -> Result<Vec<dit_core::SampleRef>, DawError> {
    let mut samples = samples::Samples::default();
    walk(doc, &mut [&mut samples])?;
    Ok(samples.into_refs())
}

fn walk(doc: &[u8], readers: &mut [&mut dyn Visitor]) -> Result<(), DawError> {
    let mut xml = Reader::from_reader(doc);
    let mut stack: Vec<String> = Vec::new();
    let mut seen_root = false;

    loop {
        match xml.read_event().map_err(malformed)? {
            Event::Start(element) => {
                stack.push(tag_name(&element));
                seen_root = true;
                open(readers, &stack, &element);
            }
            Event::Empty(element) => {
                stack.push(tag_name(&element));
                seen_root = true;
                open(readers, &stack, &element);
                close(readers, &stack);
                stack.pop();
            }
            Event::End(_) => {
                // quick-xml has already checked that the end tag names the
                // open element, so the stack cannot be empty here.
                close(readers, &stack);
                stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !stack.is_empty() {
        return Err(DawError::Malformed(format!(
            "unclosed element <{}>",
            stack.last().map_or("", String::as_str)
        )));
    }
    if !seen_root {
        return Err(DawError::Malformed("no root element".to_string()));
    }
    Ok(())
}

fn open(readers: &mut [&mut dyn Visitor], stack: &[String], element: &BytesStart) {
    let (path, tag) = (Path(stack), Tag(element));
    for reader in readers.iter_mut() {
        reader.start(&path, &tag);
    }
}

fn close(readers: &mut [&mut dyn Visitor], stack: &[String]) {
    let path = Path(stack);
    for reader in readers.iter_mut() {
        reader.end(&path);
    }
}

fn tag_name(element: &BytesStart) -> String {
    element.name().as_ref().to_string()
}

fn malformed(error: impl std::fmt::Display) -> DawError {
    DawError::Malformed(error.to_string())
}

/// `text` with the five predefined entities and every numeric reference
/// turned back into the characters they stand for. A reference that names no
/// character (past U+10FFFF, or a surrogate) or an entity Live never writes is
/// left as written rather than failing the read.
pub(crate) fn decode_entities(text: &str) -> Cow<'_, str> {
    /// `&`, the longest body worth reading (`#x10FFFF`, with room for leading
    /// zeros) and `;`.
    const ENTITY_REACH: usize = 32;
    if !text.contains('&') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        // The `;` is looked for only within an entity's reach, so a long run of
        // `&` with no `;` stays linear rather than rescanning to the end.
        match rest
            .bytes()
            .take(ENTITY_REACH)
            .position(|byte| byte == b';')
            .and_then(|end| entity_char(&rest[1..end]).map(|character| (character, end)))
        {
            Some((character, end)) => {
                out.push(character);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// The character an entity body (`amp`, `#38`, `#x26`) stands for.
fn entity_char(body: &str) -> Option<char> {
    match body {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => {
            let digits = body.strip_prefix('#')?;
            let code = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => parse_digits(hex, 16)?,
                None => parse_digits(digits, 10)?,
            };
            char::from_u32(code)
        }
    }
}

/// A non-empty run of digits in `radix`, with no sign; `None` when it is
/// anything else or overflows.
fn parse_digits(digits: &str, radix: u32) -> Option<u32> {
    if digits.is_empty() || !digits.chars().all(|digit| digit.is_digit(radix)) {
        return None;
    }
    u32::from_str_radix(digits, radix).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_predefined_entities_and_numeric_references() {
        assert_eq!(
            decode_entities("Drums &amp; Bass &lt;1&gt; &quot;x&quot; &apos;y&apos;"),
            "Drums & Bass <1> \"x\" 'y'"
        );
        assert_eq!(decode_entities("a&#38;b &#x26; &#X41; &#65;"), "a&b & A A");
    }

    #[test]
    fn a_long_run_of_ampersands_with_no_semicolon_decodes_cleanly() {
        let text = "&".repeat(100_000);
        let closed = format!("{text}&amp;");
        assert_eq!(decode_entities(&text), text);
        assert_eq!(decode_entities(&closed), format!("{text}&"));
    }

    #[test]
    fn leaves_a_reference_that_names_no_character_as_written() {
        for text in [
            "&#1114112;",
            "&#x110000;",
            "&#xD800;",
            "&#99999999999;",
            "&#;",
            "&#x;",
            "&#-1;",
            "&nbsp;",
            "a & b",
            "&amp",
        ] {
            assert_eq!(decode_entities(text), text, "{text}");
        }
        assert_eq!(decode_entities("&#x10FFFF;"), "\u{10FFFF}");
    }

    #[test]
    fn does_not_decode_twice() {
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
    }

    #[test]
    fn a_path_matches_alternatives_and_wildcards() {
        let stack: Vec<String> = ["Ableton", "LiveSet", "MainTrack"]
            .map(String::from)
            .to_vec();
        let path = Path(&stack);
        assert!(path.is(&["*", "LiveSet", "MainTrack|MasterTrack"]));
        assert!(!path.is(&["*", "LiveSet"]));
        assert!(path.starts_with(&["Ableton", "LiveSet"]));
        assert!(!path.starts_with(&["Ableton", "Tracks"]));
        assert_eq!(path.depth(), 3);
        assert_eq!(path.at(1), Some("LiveSet"));
        assert_eq!(path.at(3), None);
    }

    #[test]
    fn malformed_documents_are_refused() {
        for doc in [
            "<Ableton><LiveSet></Ableton>",
            "<Ableton><LiveSet>",
            "<Ableton><LiveSet",
            "<a></b>",
            "",
            "   ",
            "just text",
        ] {
            assert!(
                matches!(parse(doc.as_bytes()), Err(DawError::Malformed(_))),
                "{doc:?}"
            );
        }
    }

    #[test]
    fn a_set_with_no_fields_reads_as_all_null_but_no_samples() {
        let meta = parse(b"<Ableton><LiveSet/></Ableton>").unwrap();
        assert_eq!(
            meta,
            SetMeta {
                sample_paths: Some(vec![]),
                ..SetMeta::default()
            }
        );
    }
}
