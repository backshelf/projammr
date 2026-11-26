//! The `Analysis` session (`lib.rs`'s `analysis_*` exports): one interleaved
//! stream fanned out to the peaks, loudness and long-term average spectrum
//! analysers a session's flags name, the live readouts the worklet polls once
//! per hop, and the offline analysers that run when the stream ends. Every
//! export lives in `lib.rs`; these modules are ordinary Rust with native tests.

mod live;
mod loudness;
pub mod offline;
mod peaks;
mod session;
mod spectrum;

pub use session::Session;
