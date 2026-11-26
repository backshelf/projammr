//! Headphone crossfeed after Boris Mikhaylov's "Bauer stereophonic-to-binaural
//! DSP" (bs2b, MIT; <https://bs2b.sourceforge.net/>), at its default preset:
//! each channel low-passed at 700 Hz and fed into the other 4.5 dB down, with
//! a matching high-shelf on the direct path so the tonal balance holds. The
//! one-pole low-pass supplies the interaural delay.

use std::f64::consts::PI;

use super::params::ParamId;
use super::{Block, CHANNELS};

const CUTOFF_HZ: f64 = 700.0;
const FEED_DB: f64 = 4.5;

pub struct Crossfeed {
    a0_lo: f64,
    b1_lo: f64,
    a0_hi: f64,
    a1_hi: f64,
    b1_hi: f64,
    gain: f64,
    lo: [f64; CHANNELS],
    hi: [f64; CHANNELS],
    previous_input: [f64; CHANNELS],
}

impl Crossfeed {
    pub fn new(rate: f32) -> Self {
        let rate = f64::from(rate);
        let gain_lo_db = FEED_DB * -5.0 / 6.0 - 3.0;
        let gain_hi_db = FEED_DB / 6.0 - 3.0;
        let g_lo = 10f64.powf(gain_lo_db / 20.0);
        let g_hi = 1.0 - 10f64.powf(gain_hi_db / 20.0);
        let cutoff_hi = CUTOFF_HZ * 2f64.powf((gain_lo_db - 20.0 * g_hi.log10()) / 12.0);

        let x_lo = (-2.0 * PI * CUTOFF_HZ / rate).exp();
        let x_hi = (-2.0 * PI * cutoff_hi / rate).exp();
        Self {
            a0_lo: g_lo * (1.0 - x_lo),
            b1_lo: x_lo,
            a0_hi: 1.0 - g_hi * (1.0 - x_hi),
            a1_hi: -x_hi,
            b1_hi: x_hi,
            gain: 1.0 / (1.0 - g_hi + g_lo),
            lo: [0.0; CHANNELS],
            hi: [0.0; CHANNELS],
            previous_input: [0.0; CHANNELS],
        }
    }
}

impl Block for Crossfeed {
    fn set(&mut self, _param: ParamId, _value: f32) {}

    fn process(&mut self, samples: &mut [f32]) {
        for frame in samples.chunks_exact_mut(CHANNELS) {
            for (c, sample) in frame.iter().enumerate() {
                let x = f64::from(*sample);
                self.lo[c] = self.a0_lo * x + self.b1_lo * self.lo[c];
                self.hi[c] =
                    self.a0_hi * x + self.a1_hi * self.previous_input[c] + self.b1_hi * self.hi[c];
                self.previous_input[c] = x;
            }
            frame[0] = ((self.hi[0] + self.lo[1]) * self.gain) as f32;
            frame[1] = ((self.hi[1] + self.lo[0]) * self.gain) as f32;
        }
    }

    fn reset(&mut self) {
        self.lo = [0.0; CHANNELS];
        self.hi = [0.0; CHANNELS];
        self.previous_input = [0.0; CHANNELS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// Steady-state peak levels in each channel for a sine in the left only.
    fn left_only(hz: f32) -> (f32, f32) {
        let mut crossfeed = Crossfeed::new(RATE);
        let mut samples: Vec<f32> = (0..RATE as usize)
            .flat_map(|i| [(std::f32::consts::TAU * hz * i as f32 / RATE).sin(), 0.0])
            .collect();
        crossfeed.process(&mut samples);
        let tail = &samples[samples.len() / 2..];
        let peak = |c: usize| {
            tail.iter()
                .skip(c)
                .step_by(2)
                .fold(0f32, |m, v| m.max(v.abs()))
        };
        (peak(0), peak(1))
    }

    #[test]
    fn a_centred_signal_keeps_its_level() {
        let mut crossfeed = Crossfeed::new(RATE);
        let mut samples = vec![0.5f32; 2 * RATE as usize];
        crossfeed.process(&mut samples);
        let last = samples.len() - 1;
        assert!((samples[last] - 0.5).abs() < 1e-4, "{}", samples[last]);
    }

    #[test]
    fn low_frequencies_cross_about_4_5_db_below_the_direct_path() {
        let (direct, crossed) = left_only(100.0);
        let difference = 20.0 * (direct / crossed).log10();
        assert!((difference - FEED_DB as f32).abs() < 1.0, "{difference}");
    }

    #[test]
    fn high_frequencies_barely_cross() {
        let (direct, crossed) = left_only(8000.0);
        assert!(20.0 * (direct / crossed).log10() > 15.0);
    }
}
