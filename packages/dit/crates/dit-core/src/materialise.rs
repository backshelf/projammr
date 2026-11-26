//! Reading a stored save back into its document. Compiles without the `store`
//! feature so the wasm build can materialise from an in-memory pack.

use thiserror::Error;

use crate::daw::{Daw, DawError, unmask_tree};
use crate::store::{ObjectId, ObjectKind, ObjectRead, StoreError, read_tree};

/// Why a save could not be materialised.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum MaterialiseError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Daw(#[from] DawError),
}

/// The set's XML document as it was when saved, byte for byte: each Text
/// leaf unmasked with the side list as it was masked, then the leaves joined. `side` names a Blob whose
/// body is the side list as a JSON array of strings.
pub fn materialise_xml(
    objects: &impl ObjectRead,
    daw: &dyn Daw,
    tree: &ObjectId,
    side: &ObjectId,
) -> Result<Vec<u8>, MaterialiseError> {
    let tree = read_tree(objects, tree)?;
    let (kind, body) = objects.get(side)?;
    if kind != ObjectKind::Blob {
        return Err(
            StoreError::Malformed(format!("object {side} is a {kind:?}, not a Blob")).into(),
        );
    }
    let side: Vec<String> =
        serde_json::from_slice(&body).map_err(|e| StoreError::Malformed(e.to_string()))?;
    Ok(unmask_tree(daw, &tree, &side)?)
}
