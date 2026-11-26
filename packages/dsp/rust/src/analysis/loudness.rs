//! BS.1770 loudness over a whole stream: integrated loudness, loudness range
//! and true peak.

use ebur128::{EbuR128, Mode};

use crate::error::DspError;

/// Below this a primed reading is `-inf`, not a number hundreds of LU down
/// that a filter's decaying tail can produce.
pub const ABSOLUTE_GATE_LUFS: f64 = -70.0;

/// Frames in a loudness window of `blocks` 100 ms blocks at `rate`, rounded
/// the way `ebur128` rounds its own 100 ms block, so a correction divides by
/// the window it actually keeps.
pub fn window_frames(rate: u32, blocks: u64) -> u64 {
    (u64::from(rate) + 5) / 10 * blocks
}

/// `raw` LUFS from a window of `window` frames corrected as though the window
/// held only the `fed` frames that have actually arrived, gated at
/// [`ABSOLUTE_GATE_LUFS`].
///
/// `ebur128`'s momentary and short-term windows are zero-filled ring buffers,
/// so a query before a window fills averages real samples against trailing
/// zeros and reads quiet. Dividing the mean square by `filled` rather than
/// `window` adds `10·log10(window / filled)` to the LUFS, which is exact
/// because LUFS is `10·log10(energy) − 0.691`; a full window's offset is 0,
/// and `-inf` plus a finite offset stays `-inf`.
pub fn primed_lufs(raw: f64, window: u64, fed: u64) -> f64 {
    let filled = fed.min(window).max(1) as f64;
    let corrected = raw + 10.0 * (window as f64 / filled).log10();
    if corrected < ABSOLUTE_GATE_LUFS {
        f64::NEG_INFINITY
    } else {
        corrected
    }
}

/// Wraps one `ebur128::EbuR128` instance in every mode the session's stored
/// figures need. `Mode::TRUE_PEAK` already implies `Mode::SAMPLE_PEAK`, and
/// `Mode::I`/`Mode::LRA` already imply `Mode::M`/`Mode::S`; the four named
/// here are the ones the plan calls out.
pub struct Loudness {
    meter: EbuR128,
    shortterm_window: u64,
    fed: u64,
}

impl Loudness {
    pub fn new(channels: u32, rate: u32) -> Result<Self, DspError> {
        let mode = Mode::I | Mode::LRA | Mode::TRUE_PEAK | Mode::M | Mode::S;
        let meter = EbuR128::new(channels, rate, mode).map_err(|_| DspError::BadArgument)?;
        Ok(Self {
            meter,
            shortterm_window: window_frames(rate, 30),
            fed: 0,
        })
    }

    pub fn push(&mut self, interleaved: &[f32]) {
        // The caller (`Session::push`) has already checked the frame count is
        // a multiple of the channel count, so this cannot fail.
        let _ = self.meter.add_frames_f32(interleaved);
        self.fed += (interleaved.len() / self.meter.channels() as usize) as u64;
    }

    /// Short-term LUFS over the last 3 s, primed ([`primed_lufs`]) and
    /// gated, unrounded.
    pub fn short_term(&self) -> f64 {
        let raw = self.meter.loudness_shortterm().unwrap_or(f64::NEG_INFINITY);
        primed_lufs(raw, self.shortterm_window, self.fed)
    }

    /// The largest true peak over every channel of the last `push`, linear.
    pub fn last_true_peak(&self) -> f64 {
        (0..self.meter.channels())
            .map(|channel| self.meter.prev_true_peak(channel).unwrap_or(0.0))
            .fold(0.0_f64, f64::max)
    }

    /// Integrated loudness in LUFS, rounded to one decimal; `-inf` when no
    /// gating block ever passed the absolute and relative gates.
    pub fn integrated(&self) -> f64 {
        round1(self.meter.loudness_global().unwrap_or(f64::NEG_INFINITY))
    }

    /// Loudness range in LU, rounded to one decimal; 0 without enough history.
    pub fn range(&self) -> f64 {
        round1(self.meter.loudness_range().unwrap_or(0.0))
    }

    /// `20·log10(max true peak)` over every channel, rounded to one decimal;
    /// `-inf` for silence.
    pub fn true_peak_db(&self) -> f64 {
        let peak = (0..self.meter.channels())
            .map(|channel| self.meter.true_peak(channel).unwrap_or(0.0))
            .fold(0.0_f64, f64::max);
        round1(if peak > 0.0 {
            20.0 * peak.log10()
        } else {
            f64::NEG_INFINITY
        })
    }
}

fn round1(value: f64) -> f64 {
    if value.is_finite() {
        (value * 10.0).round() / 10.0
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine_stereo(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
        sine_stereo_phased(hz, amplitude, seconds, 0.0)
    }

    fn sine_stereo_phased(hz: f32, amplitude: f32, seconds: f32, phase: f32) -> Vec<f32> {
        let n = (RATE as f32 * seconds) as usize;
        let mut interleaved = Vec::with_capacity(n * 2);
        for i in 0..n {
            let sample = amplitude
                * (2.0 * core::f32::consts::PI * hz * i as f32 / RATE as f32 + phase).sin();
            interleaved.push(sample);
            interleaved.push(sample);
        }
        interleaved
    }

    #[test]
    fn a_half_amplitude_stereo_sine_reads_about_minus_six_lufs() {
        let mut loudness = Loudness::new(2, RATE).unwrap();
        loudness.push(&sine_stereo(1000.0, 0.5, 2.0));

        assert!(
            (loudness.integrated() - -6.0).abs() < 0.1,
            "{}",
            loudness.integrated()
        );
        assert!(
            (loudness.true_peak_db() - -6.02).abs() < 0.05,
            "{}",
            loudness.true_peak_db()
        );
        assert_eq!(loudness.range(), 0.0);
    }

    #[test]
    fn the_absolute_gate_ignores_leading_silence() {
        let mut with_silence = Loudness::new(2, RATE).unwrap();
        with_silence.push(&vec![0.0; RATE as usize * 2 * 5]);
        with_silence.push(&sine_stereo(1000.0, 0.5, 5.0));

        let mut sine_only = Loudness::new(2, RATE).unwrap();
        sine_only.push(&sine_stereo(1000.0, 0.5, 5.0));

        assert!(
            (with_silence.integrated() - sine_only.integrated()).abs() <= 0.2,
            "with silence {}, sine only {}",
            with_silence.integrated(),
            sine_only.integrated()
        );
    }

    #[test]
    fn a_loud_sine_reads_true_peak_above_zero_from_oversampling() {
        let mut loudness = Loudness::new(2, RATE).unwrap();
        // A cosine's crest lands exactly on a sample (every 48 samples at
        // 1 kHz/48 kHz), so this isolates the interpolation filter's own
        // passband ripple rather than a between-samples peak: oversampled
        // true peak reads louder than the digital samples ever do, which is
        // the whole point of true-peak metering (a D/A converter's own
        // reconstruction filter can ring the same way).
        let phase = core::f32::consts::FRAC_PI_2;
        loudness.push(&sine_stereo_phased(1000.0, 0.99, 1.0, phase));

        assert!(loudness.true_peak_db() > 0.0, "{}", loudness.true_peak_db());
    }

    #[test]
    fn silence_reads_negative_infinity_integrated_and_true_peak() {
        let mut loudness = Loudness::new(2, RATE).unwrap();
        loudness.push(&vec![0.0; RATE as usize * 2]);

        assert_eq!(loudness.integrated(), f64::NEG_INFINITY);
        assert_eq!(loudness.true_peak_db(), f64::NEG_INFINITY);
    }

    #[test]
    fn construction_rejects_zero_channels() {
        assert_eq!(Loudness::new(0, RATE).err(), Some(DspError::BadArgument));
    }
}
