//! Time and pitch: a pitch ratio `r` at speed `s` is a stretch by `r / s`
//! followed by reading the stretched stream at rate `r` through `rubato`'s
//! asynchronous polynomial resampler. The mode says which of the two the
//! listener moves.
//!
//! The stage pulls: asked for output frames, it reads as many source frames
//! as it needs.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Adjustable, Async, FixedAsync, PolynomialDegree, Resampler};

use super::CHANNELS;
use super::params::{ParamId, choices};
use super::stretch::{HOP, Stretcher};

/// The resampler's fixed output chunk: one render quantum.
pub const CHUNK: usize = 128;
/// The resampler's ratio stays within this factor of 1 either way: ±12
/// semitones, or speed 0.5 to 2.
const MAX_RESAMPLE_RELATIVE: f64 = 2.0;

choices! {
    /// Which of speed and pitch the listener sets.
    pub enum TimeMode {
        /// Speed changes and pitch holds.
        Speed,
        /// Pitch changes and speed holds.
        Pitch,
        /// Speed and pitch move together, like tape.
        Linked,
        /// Speed and pitch are set apart.
        Independent,
    }
}

impl TimeMode {
    /// The stretch ratio and the resampler's output-to-input ratio for a
    /// speed and a pitch in semitones.
    pub fn ratios(self, speed: f64, semitones: f64) -> (f64, f64) {
        let r = 2f64.powf(semitones / 12.0);
        match self {
            TimeMode::Speed => (1.0 / speed, 1.0),
            TimeMode::Pitch => (r, 1.0 / r),
            TimeMode::Linked => (1.0, 1.0 / speed),
            TimeMode::Independent => (r / speed, 1.0 / r),
        }
    }
}

/// A queue of interleaved stereo frames with a fixed capacity.
struct Frames {
    samples: Vec<f32>,
    len: usize,
}

impl Frames {
    fn with_capacity(frames: usize) -> Self {
        Self {
            samples: vec![0.0; frames * CHANNELS],
            len: 0,
        }
    }

    fn filled(&self) -> &[f32] {
        &self.samples[..self.len * CHANNELS]
    }

    /// Room for `frames` more; call [`Frames::commit`] with what was written.
    fn spare(&mut self, frames: usize) -> &mut [f32] {
        &mut self.samples[self.len * CHANNELS..(self.len + frames) * CHANNELS]
    }

    fn commit(&mut self, frames: usize) {
        self.len += frames;
    }

    /// Moves the oldest `out.len()` samples into `out`.
    fn take_into(&mut self, out: &mut [f32]) {
        let n = out.len();
        out.copy_from_slice(&self.samples[..n]);
        self.drop_front(n / CHANNELS);
    }

    fn drop_front(&mut self, frames: usize) {
        self.samples
            .copy_within(frames * CHANNELS..self.len * CHANNELS, 0);
        self.len -= frames;
    }
}

pub struct TimePitch {
    stretcher: Stretcher,
    resampler: Async<f32>,
    resampling: bool,
    mode: TimeMode,
    speed: f32,
    semitones: f32,
    bypassed: bool,
    /// The stretcher's output waiting for the resampler.
    stretched: Frames,
    /// Finished output waiting for the caller.
    ready: Frames,
}

impl TimePitch {
    pub fn new() -> Self {
        let resampler = Async::<f32>::new_poly(
            1.0,
            MAX_RESAMPLE_RELATIVE,
            PolynomialDegree::Septic,
            CHUNK,
            CHANNELS,
            FixedAsync::Output,
        )
        .expect("the resampler's fixed arguments are valid");
        let stretched_capacity = resampler.input_frames_max() + HOP;
        let default = |param: ParamId| param.spec().domain.default_value();
        let mut stage = Self {
            stretcher: Stretcher::new(),
            resampler,
            resampling: false,
            mode: TimeMode::from_value(default(ParamId::TimeMode)),
            speed: default(ParamId::TimeSpeed),
            semitones: default(ParamId::TimePitchSemitones),
            bypassed: false,
            ready: Frames::with_capacity(CHUNK.max(HOP) + stretched_capacity),
            stretched: Frames::with_capacity(stretched_capacity),
        };
        stage.retune();
        stage
    }

    pub fn set(&mut self, param: ParamId, value: f32) {
        match param {
            ParamId::TimeMode => self.mode = TimeMode::from_value(value),
            ParamId::TimeSpeed => self.speed = value,
            _ => self.semitones = value,
        }
        self.retune();
    }

    /// Bypassed, the stage plays at speed 1 and pitch 0 with its latency kept.
    pub fn set_bypass(&mut self, bypassed: bool) {
        self.bypassed = bypassed;
        self.retune();
    }

    fn retune(&mut self) {
        let (stretch, resample) = if self.bypassed {
            (1.0, 1.0)
        } else {
            self.mode
                .ratios(f64::from(self.speed), f64::from(self.semitones))
        };
        self.stretcher.set_ratio(stretch);
        let resampling = resample != 1.0;
        if resampling && !self.resampling {
            self.resampler.reset();
            self.set_resample_ratio(resample, false);
        } else if resampling {
            self.set_resample_ratio(resample, true);
        }
        self.resampling = resampling;
    }

    fn set_resample_ratio(&mut self, ratio: f64, ramp: bool) {
        // Every mode keeps the ratio within the resampler's bounds.
        let _ = self.resampler.set_resample_ratio(ratio, ramp);
    }

    /// Output frames between a source frame being read and being heard.
    pub fn latency(&self) -> usize {
        let stretched = self.stretcher.latency();
        if self.resampling {
            (stretched * self.resampler.resample_ratio()).round() as usize
                + self.resampler.output_delay()
        } else {
            stretched.round() as usize
        }
    }

    pub fn reset(&mut self) {
        self.stretcher.reset();
        self.resampler.reset();
        self.stretched.len = 0;
        self.ready.len = 0;
        self.resampling = false;
        self.retune();
    }

    /// Fills `out` with interleaved output, reading interleaved source frames
    /// from `source` at frame `*consumed` and advancing it. Source past the
    /// end of `source` reads as silence.
    pub fn pull(&mut self, source: &[f32], consumed: &mut usize, out: &mut [f32]) {
        let frames = out.len() / CHANNELS;
        while self.ready.len < frames {
            if !self.resampling && self.stretched.len > 0 {
                let n = self.stretched.len;
                self.ready.spare(n).copy_from_slice(self.stretched.filled());
                self.ready.commit(n);
                self.stretched.len = 0;
            } else if self.resampling {
                let needed = self.resampler.input_frames_next();
                while self.stretched.len < needed {
                    self.stretcher
                        .step(source, consumed, self.stretched.spare(HOP));
                    self.stretched.commit(HOP);
                }
                let input =
                    InterleavedSlice::new(self.stretched.filled(), CHANNELS, self.stretched.len)
                        .expect("the queue holds whole frames");
                let mut output =
                    InterleavedSlice::new_mut(self.ready.spare(CHUNK), CHANNELS, CHUNK)
                        .expect("the spare room holds whole frames");
                let (read, written) = self
                    .resampler
                    .process_into_buffer(&input, &mut output, None)
                    .expect("the buffers hold what the resampler asked for");
                self.stretched.drop_front(read);
                self.ready.commit(written);
            } else {
                self.stretcher.step(source, consumed, self.ready.spare(HOP));
                self.ready.commit(HOP);
            }
        }
        self.ready.take_into(out);
    }
}

impl Default for TimePitch {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::stretch::tests::{RATE, loudest_hz, sine};

    /// Plays `seconds` of a sine through the stage and returns the output
    /// with the latency trimmed, plus the source frames read.
    fn play(stage: &mut TimePitch, hz: f32, seconds: f32, out_seconds: f32) -> (Vec<f32>, usize) {
        let source = sine(hz, (seconds * RATE as f32) as usize);
        let mut out = vec![0.0; (out_seconds * RATE as f32) as usize / CHUNK * CHUNK * CHANNELS];
        let mut consumed = 0;
        for chunk in out.chunks_mut(CHUNK * CHANNELS) {
            stage.pull(&source, &mut consumed, chunk);
        }
        out.drain(..stage.latency() * CHANNELS);
        (out, consumed)
    }

    fn stage(mode: TimeMode, speed: f32, semitones: f32) -> TimePitch {
        let mut stage = TimePitch::new();
        stage.set(ParamId::TimeMode, mode as usize as f32);
        stage.set(ParamId::TimeSpeed, speed);
        stage.set(ParamId::TimePitchSemitones, semitones);
        stage
    }

    /// Source frames read per output frame, measured over a long run.
    fn source_rate(stage: &mut TimePitch) -> f64 {
        let (out, consumed) = play(stage, 440.0, 20.0, 4.0);
        consumed as f64 / (out.len() / CHANNELS + stage.latency()) as f64
    }

    const BIN_HZ: f32 = RATE as f32 / 8192.0;

    #[test]
    fn up_12_semitones_turns_440_hz_into_880_hz_at_the_same_speed() {
        let mut up = stage(TimeMode::Pitch, 1.0, 12.0);
        let (out, _) = play(&mut up, 440.0, 2.0, 1.5);
        let hz = loudest_hz(&out, RATE / 2);
        assert!((hz - 880.0).abs() <= 2.0f32.max(BIN_HZ / 2.0), "{hz}");
        let mut up = stage(TimeMode::Pitch, 1.0, 12.0);
        assert!((source_rate(&mut up) - 1.0).abs() < 0.01);
    }

    #[test]
    fn down_12_semitones_turns_440_hz_into_220_hz() {
        let mut down = stage(TimeMode::Pitch, 1.0, -12.0);
        let (out, _) = play(&mut down, 440.0, 2.0, 1.5);
        let hz = loudest_hz(&out, RATE / 2);
        assert!((hz - 220.0).abs() <= BIN_HZ / 2.0 + 1.0, "{hz}");
    }

    #[test]
    fn half_speed_holds_pitch_and_reads_the_source_at_half_rate() {
        let mut slow = stage(TimeMode::Speed, 0.5, 0.0);
        let (out, _) = play(&mut slow, 440.0, 2.0, 1.5);
        assert!((loudest_hz(&out, RATE / 2) - 440.0).abs() <= BIN_HZ);
        let mut slow = stage(TimeMode::Speed, 0.5, 0.0);
        assert!((source_rate(&mut slow) - 0.5).abs() < 0.01);
    }

    #[test]
    fn linked_1_5_raises_pitch_and_speed_together() {
        let mut tape = stage(TimeMode::Linked, 1.5, 0.0);
        let (out, _) = play(&mut tape, 440.0, 3.0, 1.5);
        assert!((loudest_hz(&out, RATE / 2) - 660.0).abs() <= BIN_HZ);
        let mut tape = stage(TimeMode::Linked, 1.5, 0.0);
        assert!((source_rate(&mut tape) - 1.5).abs() < 0.01);
    }

    #[test]
    fn independent_speed_and_pitch_combine() {
        let mut both = stage(TimeMode::Independent, 0.75, 7.0);
        let (out, _) = play(&mut both, 440.0, 3.0, 2.0);
        let expected = 440.0 * 2f32.powf(7.0 / 12.0);
        assert!((loudest_hz(&out, RATE / 2) - expected).abs() <= BIN_HZ);
        let mut both = stage(TimeMode::Independent, 0.75, 7.0);
        assert!((source_rate(&mut both) - 0.75).abs() < 0.01);
    }

    #[test]
    fn bypassed_the_stage_passes_the_source_through_after_its_latency() {
        let mut stage = stage(TimeMode::Linked, 1.5, 0.0);
        stage.set_bypass(true);
        let source = sine(440.0, RATE);
        let (out, _) = play(&mut stage, 440.0, 1.0, 1.0);
        assert_eq!(&out[..8000], &source[..8000]);
    }
}
