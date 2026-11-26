//! The tree a DAW module splits a document into: byte ranges that partition
//! the document exactly, so joining them is concatenation.

/// What a part of the document is to the DAW.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartKind {
    Gap,
    Track,
    Section,
}

/// Whether a leaf's bytes are text a line diff can read or an opaque blob.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeafKind {
    Text,
    Blob,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Leaf {
    pub kind: LeafKind,
    pub tag: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Part {
    pub kind: PartKind,
    pub tag: Option<String>,
    pub id: Option<String>,
    pub leaves: Vec<Leaf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Tree {
    pub parts: Vec<Part>,
}

/// Every leaf's bytes in order: the document the tree was split from.
pub fn join(tree: &Tree) -> Vec<u8> {
    tree.parts
        .iter()
        .flat_map(|part| &part.leaves)
        .flat_map(|leaf| leaf.bytes.iter().copied())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(kind: LeafKind, bytes: &[u8]) -> Leaf {
        Leaf {
            kind,
            tag: None,
            bytes: bytes.to_vec(),
        }
    }

    #[test]
    fn join_concatenates_every_leaf_in_order() {
        let tree = Tree {
            parts: vec![
                Part {
                    kind: PartKind::Gap,
                    tag: None,
                    id: None,
                    leaves: vec![leaf(LeafKind::Text, b"<Ableton>")],
                },
                Part {
                    kind: PartKind::Track,
                    tag: Some("MidiTrack".into()),
                    id: Some("3".into()),
                    leaves: vec![
                        leaf(LeafKind::Text, b"<a/>"),
                        leaf(LeafKind::Blob, &[0, 255]),
                    ],
                },
                Part {
                    kind: PartKind::Section,
                    tag: None,
                    id: None,
                    leaves: vec![],
                },
                Part {
                    kind: PartKind::Gap,
                    tag: None,
                    id: None,
                    leaves: vec![leaf(LeafKind::Text, b"</Ableton>")],
                },
            ],
        };
        let mut expected = b"<Ableton><a/>".to_vec();
        expected.extend([0, 255]);
        expected.extend(b"</Ableton>");
        assert_eq!(join(&tree), expected);
    }

    #[test]
    fn join_of_an_empty_tree_is_empty() {
        assert!(join(&Tree::default()).is_empty());
    }
}
