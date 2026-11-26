//! The error codes every export reports, and the last-error slot that
//! `*_new` and `dsp_alloc` write before returning 0.
//!
//! `packages/dsp/src/runtime.ts` names the same codes in `DspErrorCode`;
//! `runtime.test.ts` reads this enum and fails when the two disagree.

use std::cell::Cell;

#[repr(i32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DspError {
    None = 0,
    /// The handle names no live object of the kind the export expects.
    BadHandle = 1,
    /// An argument is outside what the export accepts.
    BadArgument = 2,
    /// The request is valid but this build cannot serve it.
    Unsupported = 3,
    /// Memory, or a table of handles, could not grow.
    OutOfMemory = 4,
}

thread_local! {
    // wasm32-unknown-unknown has no threads, so this is one static cell.
    static LAST: Cell<DspError> = const { Cell::new(DspError::None) };
}

impl DspError {
    /// Records `self` as the reason the current call failed. A later success
    /// leaves it in place, so it is read only after a call reports failure.
    pub fn record(self) {
        LAST.set(self);
    }

    pub fn last() -> DspError {
        LAST.get()
    }

    /// The code an export returns for `result`: 0 on success.
    pub fn status(result: Result<(), DspError>) -> i32 {
        match result {
            Ok(()) => DspError::None as i32,
            Err(error) => error as i32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_the_last_failure() {
        DspError::BadArgument.record();
        DspError::OutOfMemory.record();
        assert_eq!(DspError::last(), DspError::OutOfMemory);
    }

    #[test]
    fn status_is_zero_on_success_and_the_code_on_failure() {
        assert_eq!(DspError::status(Ok(())), 0);
        assert_eq!(DspError::status(Err(DspError::BadHandle)), 1);
    }
}
