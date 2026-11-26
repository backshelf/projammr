//! What the contract suite and the sweep share: running a module call so a panic is a value. Masking goes through
//! `dit_core::mask_tree` and `unmask_tree`, the path the repo stores and materialises saves by.

use std::panic::{AssertUnwindSafe, catch_unwind};

/// Runs `call`, turning a panic into its message.
pub fn catch<T>(call: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(call)).map_err(|payload| {
        payload
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic with no message".to_string())
    })
}
