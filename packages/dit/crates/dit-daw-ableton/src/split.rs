//! Splitting a set's XML into a tree of parts and leaves that concatenate back to the exact bytes.
//!
//! One pass over the bytes with a hand-written tag scanner, so every offset is exact. A part is a Gap until a
//! boundary element opens: any child of `<Tracks>` starts a Track part, and a `SECTION_TAGS` child of
//! `<LiveSet>` starts a Section part. The bytes since the previous markup's `>` move into the new part, and the
//! part ends after the boundary's closing tag (or with its self-closing tag), where a Gap starts again. Inside a
//! Track or Section part, the body of the outermost `BLOB_TAGS` element is a Blob leaf.

use dit_core::{DawError, Leaf, LeafKind, Part, PartKind, Tree};

/// Children of `<LiveSet>` that are a part of their own.
const SECTION_TAGS: [&[u8]; 4] = [b"MasterTrack", b"MainTrack", b"PreHearTrack", b"Scenes"];

/// Elements whose body is opaque plugin or sample state.
const BLOB_TAGS: [&str; 3] = ["Buffer", "ProcessorState", "ControllerState"];

/// Markup that ends at a fixed delimiter rather than at a `>` outside quotes, and never changes the element stack.
const DELIMITED: [(&[u8], &[u8], &str); 3] = [
    (b"<!--", b"-->", "comment"),
    (b"<![CDATA[", b"]]>", "CDATA section"),
    (b"<?", b"?>", "processing instruction"),
];

pub(crate) fn split(doc: &[u8]) -> Result<Tree, DawError> {
    if doc.contains(&0) {
        return Err(malformed("document contains NUL bytes".to_string()));
    }
    let mut splitter = Splitter {
        doc,
        parts: Vec::new(),
        gap_start: 0,
        open: None,
    };
    let mut stack: Vec<&[u8]> = Vec::new();
    let mut saw_element = false;
    let mut prev_end = 0;
    while let Some(offset) = doc[prev_end..].iter().position(|&b| b == b'<') {
        let start = prev_end + offset;
        let (markup, end) = read_markup(doc, start)?;
        match markup {
            Markup::Open {
                name,
                attrs,
                self_closing,
            } => {
                saw_element = true;
                splitter.open_tag(&stack, name, attrs, self_closing, prev_end, end)?;
                if !self_closing {
                    stack.push(name);
                }
            }
            Markup::Close { name } => {
                match stack.pop() {
                    Some(top) if top == name => {}
                    Some(top) => {
                        return Err(malformed(format!(
                            "</{}> at byte {start} closes <{}>",
                            String::from_utf8_lossy(name),
                            String::from_utf8_lossy(top)
                        )));
                    }
                    None => {
                        return Err(malformed(format!(
                            "</{}> at byte {start} closes no element",
                            String::from_utf8_lossy(name)
                        )));
                    }
                }
                splitter.close_tag(stack.len(), start, end);
            }
            Markup::Other => {}
        }
        prev_end = end;
    }
    if let Some(top) = stack.last() {
        return Err(malformed(format!(
            "<{}> is never closed",
            String::from_utf8_lossy(top)
        )));
    }
    if !doc.is_empty() && !saw_element {
        return Err(malformed("document has no XML elements".to_string()));
    }
    Ok(splitter.finish())
}

/// The parts built so far, and the one being built.
struct Splitter<'a> {
    doc: &'a [u8],
    parts: Vec<Part>,
    /// Where the current Gap starts; meaningful only while `open` is `None`.
    gap_start: usize,
    open: Option<OpenPart>,
}

/// A Track or Section part whose boundary element has opened and not yet closed.
struct OpenPart {
    kind: PartKind,
    tag: String,
    id: Option<String>,
    /// The stack depth the boundary element opened at.
    depth: usize,
    leaves: Vec<Leaf>,
    /// Where the part's current Text leaf starts.
    text_start: usize,
    /// The outermost blob element open inside the part.
    blob: Option<OpenBlob>,
}

struct OpenBlob {
    tag: &'static str,
    /// The stack depth the blob element opened at.
    depth: usize,
    body_start: usize,
}

impl Splitter<'_> {
    /// Handles an open tag ending at `end`, with `stack` as it was before the tag and `prev_end` the end of the
    /// markup before it.
    fn open_tag(
        &mut self,
        stack: &[&[u8]],
        name: &[u8],
        attrs: &[u8],
        self_closing: bool,
        prev_end: usize,
        end: usize,
    ) -> Result<(), DawError> {
        if let Some(open) = &mut self.open {
            if open.blob.is_none()
                && !self_closing
                && let Some(tag) = BLOB_TAGS.into_iter().find(|tag| tag.as_bytes() == name)
            {
                open.blob = Some(OpenBlob {
                    tag,
                    depth: stack.len(),
                    body_start: end,
                });
            }
            return Ok(());
        }
        let Some(kind) = boundary(stack, name) else {
            return Ok(());
        };
        let tag = utf8(name)?;
        let id = match kind {
            PartKind::Track => attribute(attrs, b"Id").map(utf8).transpose()?,
            _ => None,
        };
        self.close_gap(prev_end);
        if self_closing {
            let mut leaves = Vec::new();
            push_leaf(&mut leaves, LeafKind::Text, None, &self.doc[prev_end..end]);
            self.parts.push(Part {
                kind,
                tag: Some(tag),
                id,
                leaves,
            });
            self.gap_start = end;
        } else {
            self.open = Some(OpenPart {
                kind,
                tag,
                id,
                depth: stack.len(),
                leaves: Vec::new(),
                text_start: prev_end,
                blob: None,
            });
        }
        Ok(())
    }

    /// Handles a closing tag spanning `start..end`, with `depth` the stack depth after it popped.
    fn close_tag(&mut self, depth: usize, start: usize, end: usize) {
        let Some(open) = &mut self.open else {
            return;
        };
        if let Some(blob) = open.blob.take_if(|blob| blob.depth == depth)
            && blob.body_start < start
        {
            push_leaf(
                &mut open.leaves,
                LeafKind::Text,
                None,
                &self.doc[open.text_start..blob.body_start],
            );
            push_leaf(
                &mut open.leaves,
                LeafKind::Blob,
                Some(blob.tag.to_string()),
                &self.doc[blob.body_start..start],
            );
            open.text_start = start;
        }
        let Some(mut open) = self.open.take_if(|open| open.depth == depth) else {
            return;
        };
        push_leaf(
            &mut open.leaves,
            LeafKind::Text,
            None,
            &self.doc[open.text_start..end],
        );
        self.parts.push(Part {
            kind: open.kind,
            tag: Some(open.tag),
            id: open.id,
            leaves: open.leaves,
        });
        self.gap_start = end;
    }

    /// Ends the current Gap at `end`; an empty Gap is no part at all.
    fn close_gap(&mut self, end: usize) {
        let mut leaves = Vec::new();
        push_leaf(
            &mut leaves,
            LeafKind::Text,
            None,
            &self.doc[self.gap_start..end],
        );
        if !leaves.is_empty() {
            self.parts.push(Part {
                kind: PartKind::Gap,
                tag: None,
                id: None,
                leaves,
            });
        }
    }

    fn finish(mut self) -> Tree {
        self.close_gap(self.doc.len());
        Tree { parts: self.parts }
    }
}

/// The kind of part an element opening under `stack` starts, if it is a boundary.
fn boundary(stack: &[&[u8]], name: &[u8]) -> Option<PartKind> {
    match stack {
        [b"Ableton", b"LiveSet", b"Tracks"] => Some(PartKind::Track),
        [b"Ableton", b"LiveSet"] if SECTION_TAGS.contains(&name) => Some(PartKind::Section),
        _ => None,
    }
}

/// Appends a leaf unless `bytes` is empty: a tree never holds a zero-length leaf.
fn push_leaf(leaves: &mut Vec<Leaf>, kind: LeafKind, tag: Option<String>, bytes: &[u8]) {
    if !bytes.is_empty() {
        leaves.push(Leaf {
            kind,
            tag,
            bytes: bytes.to_vec(),
        });
    }
}

enum Markup<'a> {
    Open {
        name: &'a [u8],
        attrs: &'a [u8],
        self_closing: bool,
    },
    Close {
        name: &'a [u8],
    },
    /// A comment, CDATA section, processing instruction or declaration.
    Other,
}

/// Reads the markup whose `<` is at `start`, returning it and the offset just past its end.
fn read_markup(doc: &[u8], start: usize) -> Result<(Markup<'_>, usize), DawError> {
    let rest = &doc[start..];
    for (open, close, what) in DELIMITED {
        if rest.starts_with(open) {
            let end = find(doc, close, start + open.len())
                .ok_or_else(|| malformed(format!("unterminated {what} at byte {start}")))?;
            return Ok((Markup::Other, end + close.len()));
        }
    }
    let end = tag_end(doc, start)?;
    let inner = &doc[start + 1..end - 1];
    if inner.starts_with(b"!") {
        return Ok((Markup::Other, end));
    }
    if let Some(name) = inner.strip_prefix(b"/") {
        let name = name.trim_ascii_end();
        if name.is_empty() {
            return Err(malformed(format!(
                "closing tag at byte {start} has no name"
            )));
        }
        return Ok((Markup::Close { name }, end));
    }
    let (body, self_closing) = match inner.strip_suffix(b"/") {
        Some(body) => (body, true),
        None => (inner, false),
    };
    let name_len = body
        .iter()
        .position(u8::is_ascii_whitespace)
        .unwrap_or(body.len());
    let (name, attrs) = body.split_at(name_len);
    if name.is_empty() {
        return Err(malformed(format!("tag at byte {start} has no name")));
    }
    Ok((
        Markup::Open {
            name,
            attrs,
            self_closing,
        },
        end,
    ))
}

/// The offset just past the `>` ending the tag whose `<` is at `start`: the first `>` outside a quoted value.
fn tag_end(doc: &[u8], start: usize) -> Result<usize, DawError> {
    let mut quote = None;
    for (i, &b) in doc.iter().enumerate().skip(start + 1) {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None if b == b'"' || b == b'\'' => quote = Some(b),
            None if b == b'>' => return Ok(i + 1),
            None if b == b'<' => {
                return Err(malformed(format!(
                    "tag at byte {start} is cut off by `<` at byte {i}"
                )));
            }
            None => {}
        }
    }
    Err(malformed(format!("unterminated tag at byte {start}")))
}

/// The raw value of attribute `name` in a tag's attribute text, as written, if it is there and well formed.
fn attribute<'a>(attrs: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
    let mut rest = attrs;
    loop {
        rest = rest.trim_ascii_start();
        let key_len = rest
            .iter()
            .position(|&b| b == b'=' || b.is_ascii_whitespace())?;
        let (key, after) = rest.split_at(key_len);
        let after = after.trim_ascii_start().strip_prefix(b"=")?;
        let (&quote, after) = after.trim_ascii_start().split_first()?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let value_len = after.iter().position(|&b| b == quote)?;
        if key == name {
            return Some(&after[..value_len]);
        }
        rest = &after[value_len + 1..];
    }
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| from + offset)
}

fn utf8(bytes: &[u8]) -> Result<String, DawError> {
    String::from_utf8(bytes.to_vec())
        .map_err(|_| malformed(format!("`{}` is not UTF-8", String::from_utf8_lossy(bytes))))
}

fn malformed(message: String) -> DawError {
    DawError::Malformed(message)
}
