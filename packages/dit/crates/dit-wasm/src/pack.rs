//! The pack the host hands to `dit_materialise`: every object a save's tree
//! reaches, in memory.
//!
//! ```text
//! pack   = record*
//! record = [u8; 32] object id ‖ u8 kind ‖ u32 body_len (LE) ‖ body
//! ```

use std::collections::HashMap;

use dit_core::{ObjectId, ObjectKind, ObjectRead, StoreError};

const ID_LEN: usize = 32;
const HEADER_LEN: usize = ID_LEN + 1 + 4;

/// The objects of a pack by id, their bodies borrowed from the pack's bytes.
/// Every entry hashes to its id.
pub struct Pack<'a>(HashMap<ObjectId, (ObjectKind, &'a [u8])>);

impl<'a> Pack<'a> {
    /// Reads every record, refusing a truncated record, an unknown kind byte or
    /// a body that does not hash to its id. A repeated id can only repeat the
    /// same content, since the id is checked against it.
    pub fn parse(mut bytes: &'a [u8]) -> Result<Self, StoreError> {
        let mut objects = HashMap::new();
        while !bytes.is_empty() {
            let Some((header, rest)) = bytes.split_first_chunk::<HEADER_LEN>() else {
                return Err(StoreError::Malformed(format!(
                    "pack ends inside a record header ({} bytes left)",
                    bytes.len()
                )));
            };
            let (id, tail) = header.split_at(ID_LEN);
            let id = ObjectId::from_bytes(id.try_into().expect("the header holds a 32 byte id"));
            let kind = ObjectKind::from_byte(tail[0]).ok_or_else(|| {
                StoreError::Malformed(format!("pack record {id} has kind byte {}", tail[0]))
            })?;
            let len = u32::from_le_bytes(tail[1..].try_into().expect("the header ends in a u32"));
            let len = usize::try_from(len).unwrap_or(usize::MAX);
            let Some((body, rest)) = rest.split_at_checked(len) else {
                return Err(StoreError::Malformed(format!(
                    "pack record {id} declares {len} body bytes, {} remain",
                    rest.len()
                )));
            };
            if ObjectId::of(kind, body) != id {
                return Err(StoreError::Corrupt(id));
            }
            objects.insert(id, (kind, body));
            bytes = rest;
        }
        Ok(Self(objects))
    }
}

impl ObjectRead for Pack<'_> {
    fn get(&self, id: &ObjectId) -> Result<(ObjectKind, Vec<u8>), StoreError> {
        self.0
            .get(id)
            .map(|&(kind, body)| (kind, body.to_vec()))
            .ok_or(StoreError::Missing(*id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsed_bodies_point_into_the_input() {
        let body = b"a leaf body";
        let id = ObjectId::of(ObjectKind::Blob, body);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(id.as_bytes());
        bytes.push(ObjectKind::Blob.as_byte());
        bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
        bytes.extend_from_slice(body);

        let pack = Pack::parse(&bytes).unwrap();
        let (kind, parsed) = pack.0[&id];
        assert_eq!(kind, ObjectKind::Blob);
        assert_eq!(parsed, body);
        assert!(bytes.as_ptr_range().contains(&parsed.as_ptr()));
    }
}
