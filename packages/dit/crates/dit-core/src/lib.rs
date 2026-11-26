//! The DAW-agnostic core of dit: the object model, the repository, diffs and signing in to an instance.

#[cfg(any(feature = "store", feature = "remote"))]
mod atomic;
pub mod daw;
pub mod diff;
#[cfg(any(feature = "store", feature = "remote"))]
pub mod fingerprint;
#[cfg(any(feature = "store", feature = "remote"))]
pub mod machine;
pub mod materialise;
pub mod meta;
pub mod openset;
#[cfg(feature = "remote")]
pub mod remote;
#[cfg(feature = "store")]
pub mod repo;
#[cfg(feature = "remote")]
pub mod repos;
pub mod store;
pub mod tree;

pub use daw::{Backup, Daw, DawError, Registry, RegistryError, mask_tree, unmask_tree};
pub use diff::{
    Clause, ClauseKind, DiffSummary, INITIAL_COMMIT, ScalarChange, diff_trees, initial_clauses,
    summary_clauses, summary_line,
};
pub use materialise::{MaterialiseError, materialise_xml};
pub use meta::{
    ClipCounts, PluginInfo, SampleKind, SampleRef, SetMeta, SetStructure, StructureTrack, TrackKind,
};
pub use openset::{KitStatus, LogState, OpenSet, ScriptKit, Signal, TitleHint};
#[cfg(feature = "store")]
pub use repo::{
    BROUGHT_IN, Commit, CommitKind, HistoryEntry, ImportReport, PushSamples, RemoteBinding, Repo,
    RepoError, Save, Segment, SetOutcome, Source, format_span,
};
#[cfg(feature = "remote")]
pub use repos::RepoList;
#[cfg(feature = "store")]
pub use store::Store;
pub use store::{
    LeafEntry, ObjectId, ObjectKind, ObjectRead, PartEntry, StoreError, TreeObject, decode_tree,
    encode_part, encode_tree, read_leaf, read_tree, read_tree_object,
};
pub use tree::{Leaf, LeafKind, Part, PartKind, Tree, join};
