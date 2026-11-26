//! The playback blocks the Lab hears, and the [`chain::Chain`] that runs them
//! on the audio thread in a fixed order:
//!
//! ```text
//! source → time and pitch → band solo → EQ → compressor → reverb → stereo
//!        → crossfeed → device curve → gain → meters
//! ```
//!
//! Every block after time and pitch works in place on interleaved stereo
//! through the [`Block`] trait. A block allocates everything it needs when it
//! is made; nothing on the processing path allocates.

pub mod bands;
pub mod biquad;
pub mod chain;
pub mod crossfeed;
pub mod device;
pub mod dynamics;
pub mod eq;
pub mod gain;
pub mod params;
pub mod pitch;
pub mod reverb;
pub mod stereo;
pub mod stretch;

use params::{MeterId, ParamId};

/// Every block processes stereo.
pub const CHANNELS: usize = 2;

/// An in-place stage of the chain.
pub trait Block {
    /// Applies one of this block's parameters. The chain has already checked
    /// `value` against the parameter's domain.
    fn set(&mut self, param: ParamId, value: f32);

    /// Processes interleaved stereo in place. Parameter changes since the last
    /// call are cross-faded across these frames.
    fn process(&mut self, samples: &mut [f32]);

    /// Clears the signal state (filter memories, delay lines, envelopes) and
    /// keeps the parameters.
    fn reset(&mut self);

    /// The block's reading of `meter`, if it measures it.
    fn meter(&self, _meter: MeterId) -> Option<f32> {
        None
    }
}

/// The per-frame step that moves a value linearly from `from` to `to` across
/// `frames` frames, reaching `to` on the last one.
fn ramp_step(from: f32, to: f32, frames: usize) -> f32 {
    if frames == 0 {
        0.0
    } else {
        (to - from) / frames as f32
    }
}

fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}
