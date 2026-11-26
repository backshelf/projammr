//! The export surface of `dit.wasm`. Every `#[unsafe(no_mangle)]` function in
//! the crate is here; the pack reader is ordinary Rust with native tests.
//!
//! The module follows the rules of `dsp.wasm`, so one loader style serves both:
//!
//! - Arguments and results are numbers. Names are `snake_case` and prefixed
//!   `dit_`.
//! - A DAW is a `u32` index into the registry, in registration order.
//! - Memory the host fills is allocated with `dit_alloc` and freed with
//!   `dit_free`. Ids are 32 bytes each.
//! - `dit_parse` and `dit_materialise` return a non-zero handle to a result the
//!   module owns, or 0 on failure with the reason in `dit_last_error()`. The
//!   result is read through `dit_result_ptr` / `dit_result_len` and released
//!   with `dit_result_free`.
//! - Bad input returns an error code, never a panic. A panic traps, which the
//!   host sees as a trap, so a trap is always a bug.
//!
//! The module carries no C code: the host gunzips a set file before `dit_parse`
//! and gzips a document after `dit_materialise`.
//!
//! [`ABI_VERSION`] changes whenever an export's name, signature or meaning
//! does, and the loader refuses a module whose version it does not expect.

mod pack;
#[cfg(test)]
mod tests;

use std::cell::Cell;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use dit_core::{Daw, DawError, MaterialiseError, ObjectId, Registry, StoreError, materialise_xml};
use pack::Pack;

pub const ABI_VERSION: u32 = 1;

/// The length of an object id.
const ID_LEN: usize = 32;

/// Why an export failed, as the number `dit_last_error` reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum ErrorCode {
    None = 0,
    /// The document is not one the DAW module understands.
    Malformed = 1,
    /// The stored data does not hold together: a missing, altered or truncated object.
    Corrupt = 2,
    /// The DAW module does not do this.
    Unsupported = 3,
    /// A null pointer with a length, an unknown DAW index or an unknown handle.
    BadArgument = 4,
}

impl From<DawError> for ErrorCode {
    fn from(error: DawError) -> Self {
        match error {
            DawError::Malformed(_) => Self::Malformed,
            DawError::Corrupt(_) => Self::Corrupt,
            DawError::Unsupported => Self::Unsupported,
        }
    }
}

impl From<StoreError> for ErrorCode {
    fn from(_: StoreError) -> Self {
        Self::Corrupt
    }
}

impl From<MaterialiseError> for ErrorCode {
    fn from(error: MaterialiseError) -> Self {
        match error {
            MaterialiseError::Store(error) => error.into(),
            MaterialiseError::Daw(error) => error.into(),
        }
    }
}

thread_local! {
    static LAST_ERROR: Cell<ErrorCode> = const { Cell::new(ErrorCode::None) };
}

/// Records how an export ended and passes its value on.
fn record<T>(result: Result<T, ErrorCode>) -> Option<T> {
    let (value, code) = match result {
        Ok(value) => (Some(value), ErrorCode::None),
        Err(code) => (None, code),
    };
    LAST_ERROR.set(code);
    value
}

static DAWS: LazyLock<Registry> = LazyLock::new(dit_daws::registry);

fn daw(index: u32) -> Result<&'static dyn Daw, ErrorCode> {
    let index = usize::try_from(index).map_err(|_| ErrorCode::BadArgument)?;
    DAWS.all().get(index).copied().ok_or(ErrorCode::BadArgument)
}

/// Results the host has not freed yet, by handle. A handle is never 0.
struct Handles {
    next: u32,
    results: HashMap<u32, Vec<u8>>,
}

impl Handles {
    fn insert(&mut self, bytes: Vec<u8>) -> u32 {
        loop {
            let handle = self.next;
            self.next = handle.checked_add(1).unwrap_or(1);
            if let Entry::Vacant(slot) = self.results.entry(handle) {
                slot.insert(bytes);
                return handle;
            }
        }
    }
}

static HANDLES: LazyLock<Mutex<Handles>> = LazyLock::new(|| {
    Mutex::new(Handles {
        next: 1,
        results: HashMap::new(),
    })
});

fn handles() -> MutexGuard<'static, Handles> {
    HANDLES.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Stores a result and returns its handle, or records the failure and returns 0.
fn publish(result: Result<Vec<u8>, ErrorCode>) -> u32 {
    record(result).map_or(0, |bytes| handles().insert(bytes))
}

/// # Safety
///
/// A non-null `ptr` is valid for reads of `len` bytes for the length of the
/// call. A null `ptr` with `len` 0 is empty input, since a host has no
/// allocation to pass for nothing (`dit_alloc(0)` is refused).
unsafe fn input<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], ErrorCode> {
    if ptr.is_null() {
        return if len == 0 {
            Ok(&[])
        } else {
            Err(ErrorCode::BadArgument)
        };
    }
    // SAFETY: `ptr` is non-null and the caller guarantees `len` readable bytes.
    Ok(unsafe { std::slice::from_raw_parts(ptr, len) })
}

/// # Safety
///
/// A non-null `ptr` is valid for reads of 32 bytes for the length of the call.
unsafe fn object_id(ptr: *const u8) -> Result<ObjectId, ErrorCode> {
    // SAFETY: the caller guarantees 32 readable bytes at a non-null `ptr`.
    let bytes = unsafe { input(ptr, ID_LEN) }?;
    let bytes = <[u8; ID_LEN]>::try_from(bytes).map_err(|_| ErrorCode::BadArgument)?;
    Ok(ObjectId::from_bytes(bytes))
}

#[unsafe(no_mangle)]
pub extern "C" fn dit_abi_version() -> u32 {
    ABI_VERSION
}

/// The code the most recent export recorded: 0 none, 1 malformed, 2 corrupt,
/// 3 unsupported, 4 bad argument.
#[unsafe(no_mangle)]
pub extern "C" fn dit_last_error() -> u32 {
    LAST_ERROR.get() as u32
}

/// Allocates `bytes` for the host to fill. Returns null and records
/// `BadArgument` for 0 bytes or a size memory cannot grow to.
#[unsafe(no_mangle)]
pub extern "C" fn dit_alloc(bytes: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::new();
    if bytes == 0 || buffer.try_reserve_exact(bytes).is_err() {
        record::<()>(Err(ErrorCode::BadArgument));
        return std::ptr::null_mut();
    }
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    record(Ok(()));
    ptr
}

/// Frees an allocation `dit_alloc(bytes)` returned. A null pointer or 0 bytes
/// is ignored.
///
/// # Safety
///
/// A non-null `ptr` came from `dit_alloc` called with the same `bytes`, and has
/// not been freed since.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dit_free(ptr: *mut u8, bytes: usize) {
    record(Ok(()));
    if ptr.is_null() || bytes == 0 {
        return;
    }
    // SAFETY: the caller guarantees `dit_alloc(bytes)` returned `ptr`, which
    // reserved a buffer of exactly `bytes` bytes; length 0 drops no elements.
    drop(unsafe { Vec::from_raw_parts(ptr, 0, bytes) });
}

/// Parses the decoded XML document of a set into its `SetMeta`, as JSON. The
/// result is a handle, or 0 with the reason in `dit_last_error`.
///
/// # Safety
///
/// A non-null `xml` is valid for reads of `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dit_parse(daw_index: u32, xml: *const u8, len: usize) -> u32 {
    let parse = || {
        let daw = daw(daw_index)?;
        // SAFETY: the caller guarantees `len` readable bytes at a non-null `xml`.
        let xml = unsafe { input(xml, len) }?;
        let meta = daw.parse(xml)?;
        serde_json::to_vec(&meta).map_err(|_| ErrorCode::Malformed)
    };
    publish(parse())
}

/// Rebuilds the XML document of a save from a pack of its objects: the tree at
/// `tree` and the side list Blob at `side`. The result is a handle, or 0 with
/// the reason in `dit_last_error`.
///
/// # Safety
///
/// A non-null `pack` is valid for reads of `len` bytes, and non-null `tree` and
/// `side` for 32 bytes each.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dit_materialise(
    daw_index: u32,
    pack: *const u8,
    len: usize,
    tree: *const u8,
    side: *const u8,
) -> u32 {
    let materialise = || {
        let daw = daw(daw_index)?;
        // SAFETY: the caller guarantees `len` readable bytes at a non-null `pack`.
        let pack = unsafe { input(pack, len) }?;
        // SAFETY: the caller guarantees 32 readable bytes at each non-null id.
        let (tree, side) = unsafe { (object_id(tree)?, object_id(side)?) };
        let pack = Pack::parse(pack)?;
        Ok(materialise_xml(&pack, daw, &tree, &side)?)
    };
    publish(materialise())
}

/// The address of a result's bytes, valid until `dit_result_free`. Null and a
/// recorded `BadArgument` for an unknown handle.
#[unsafe(no_mangle)]
pub extern "C" fn dit_result_ptr(handle: u32) -> *const u8 {
    let ptr = with_result(handle, |bytes| bytes.as_ptr());
    ptr.unwrap_or(std::ptr::null())
}

/// The length of a result's bytes. 0 and a recorded `BadArgument` for an
/// unknown handle.
#[unsafe(no_mangle)]
pub extern "C" fn dit_result_len(handle: u32) -> usize {
    with_result(handle, |bytes| bytes.len()).unwrap_or(0)
}

fn with_result<T>(handle: u32, read: impl FnOnce(&[u8]) -> T) -> Option<T> {
    let value = handles().results.get(&handle).map(|bytes| read(bytes));
    record(value.ok_or(ErrorCode::BadArgument))
}

/// Frees a result. Returns 1 when it freed one, 0 for an unknown handle, which
/// also records `BadArgument`.
#[unsafe(no_mangle)]
pub extern "C" fn dit_result_free(handle: u32) -> u32 {
    let freed = handles().results.remove(&handle);
    u32::from(record(freed.map(drop).ok_or(ErrorCode::BadArgument)).is_some())
}
