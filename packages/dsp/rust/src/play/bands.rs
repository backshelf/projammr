//! Band solo: four Linkwitz-Riley 4th-order crossovers split the signal into
//! five bands, and the block plays the sum of the soloed ones (all five when
//! none is). Each band below a split also passes through that split's
//! all-pass, so every band carries the same phase and the five sum flat.

use super::biquad::{BUTTERWORTH_Q, Biquad, Coefs};
use super::params::{BAND_SOLOS, ParamId};
use super::{Block, CHANNELS};

/// The five bands, low to high.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Band {
    Low,
    LowMid,
    Mid,
    HighMid,
    Air,
}

impl Band {
    pub const COUNT: usize = 5;
}

const SPLITS: usize = Band::COUNT - 1;

/// A Linkwitz-Riley 4th-order low/high pair at one frequency: two cascaded
/// Butterworth sections each side. The two outputs sum to an all-pass.
pub struct Crossover {
    low: [Biquad; 2],
    high: [Biquad; 2],
}

impl Crossover {
    pub fn new(hz: f32, rate: f32) -> Self {
        let mut crossover = Self {
            low: std::array::from_fn(|_| Biquad::new(Coefs::IDENTITY)),
            high: std::array::from_fn(|_| Biquad::new(Coefs::IDENTITY)),
        };
        crossover.set_hz(hz, rate);
        crossover.reset();
        crossover
    }

    pub fn set_hz(&mut self, hz: f32, rate: f32) {
        for filter in &mut self.low {
            filter.set(Coefs::low_pass(hz, BUTTERWORTH_Q, rate));
        }
        for filter in &mut self.high {
            filter.set(Coefs::high_pass(hz, BUTTERWORTH_Q, rate));
        }
    }

    /// Splits `samples` in place into its low part, writing the high part to
    /// `high`.
    pub fn split(&mut self, samples: &mut [f32], high: &mut [f32]) {
        high.copy_from_slice(samples);
        for filter in &mut self.low {
            filter.process(samples);
        }
        for filter in &mut self.high {
            filter.process(high);
        }
    }

    pub fn reset(&mut self) {
        for filter in self.low.iter_mut().chain(&mut self.high) {
            filter.reset();
        }
    }
}

pub struct BandSolo {
    rate: f32,
    crossovers: [Crossover; SPLITS],
    /// `all_passes[split][band]` puts split `split`'s phase on band `band`
    /// below it.
    all_passes: [[Biquad; SPLITS]; SPLITS],
    solo: [bool; Band::COUNT],
    splits_hz: [f32; SPLITS],
    /// One stereo buffer per band, sized for the chain's largest call.
    bands: [Vec<f32>; Band::COUNT],
}

const SPLIT_PARAMS: [ParamId; SPLITS] = [
    ParamId::BandSplit1Hz,
    ParamId::BandSplit2Hz,
    ParamId::BandSplit3Hz,
    ParamId::BandSplit4Hz,
];

impl BandSolo {
    pub fn new(rate: f32, max_frames: usize) -> Self {
        let splits_hz = SPLIT_PARAMS.map(|param| param.spec().domain.default_value());
        let mut block = Self {
            rate,
            crossovers: splits_hz.map(|hz| Crossover::new(hz, rate)),
            all_passes: std::array::from_fn(|_| {
                std::array::from_fn(|_| Biquad::new(Coefs::IDENTITY))
            }),
            solo: [false; Band::COUNT],
            splits_hz,
            bands: std::array::from_fn(|_| vec![0.0; max_frames * CHANNELS]),
        };
        block.retarget();
        block.reset();
        block
    }

    fn retarget(&mut self) {
        for split in 0..SPLITS {
            let hz = self.splits_hz[split];
            self.crossovers[split].set_hz(hz, self.rate);
            for filter in &mut self.all_passes[split] {
                filter.set(Coefs::all_pass(hz, BUTTERWORTH_Q, self.rate));
            }
        }
    }
}

impl Block for BandSolo {
    fn set(&mut self, param: ParamId, value: f32) {
        if let Some(band) = BAND_SOLOS.iter().position(|&p| p == param) {
            self.solo[band] = value == 1.0;
        } else if let Some(split) = SPLIT_PARAMS.iter().position(|&p| p == param) {
            self.splits_hz[split] = value;
            self.retarget();
        }
    }

    fn process(&mut self, samples: &mut [f32]) {
        if !self.solo.contains(&true) {
            // The five bands would sum back to the input through four all-passes.
            for split in 0..SPLITS {
                self.all_passes[split][0].process(samples);
            }
            return;
        }
        let len = samples.len();
        let (lowest, rest) = self.bands.split_at_mut(1);
        lowest[0][..len].copy_from_slice(samples);
        for split in 0..SPLITS {
            // Band `split` holds everything from its lower edge up; split it.
            let (below, above) = if split == 0 {
                (&mut lowest[0][..len], &mut rest[0][..len])
            } else {
                let (lower, upper) = rest.split_at_mut(split);
                (&mut lower[split - 1][..len], &mut upper[0][..len])
            };
            self.crossovers[split].split(below, above);
            for band in 0..split {
                let buffer = if band == 0 {
                    &mut lowest[0][..len]
                } else {
                    &mut rest[band - 1][..len]
                };
                self.all_passes[split][band].process(buffer);
            }
        }

        samples.fill(0.0);
        for (band, buffer) in self.bands.iter().enumerate() {
            if self.solo[band] {
                for (out, v) in samples.iter_mut().zip(&buffer[..len]) {
                    *out += v;
                }
            }
        }
    }

    fn reset(&mut self) {
        for crossover in &mut self.crossovers {
            crossover.reset();
        }
        for filter in self.all_passes.iter_mut().flatten() {
            filter.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::biquad::tests::{RATE, measured_gain_db};

    fn solo(bands: &[Band]) -> BandSolo {
        let mut block = BandSolo::new(RATE, 128);
        for band in bands {
            block.set(BAND_SOLOS[*band as usize], 1.0);
        }
        block
    }

    #[test]
    fn soloing_every_band_sums_flat() {
        let all = [Band::Low, Band::LowMid, Band::Mid, Band::HighMid, Band::Air];
        for hz in [
            40.0, 120.0, 300.0, 500.0, 1500.0, 2500.0, 5000.0, 8000.0, 14_000.0,
        ] {
            let mut block = solo(&all);
            let gain = measured_gain_db(|s| block.process(s), hz);
            assert!(gain.abs() < 0.05, "{hz} Hz: {gain} dB");
        }
    }

    #[test]
    fn no_solo_passes_everything() {
        let mut block = solo(&[]);
        for hz in [60.0, 3000.0] {
            assert!(measured_gain_db(|s| block.process(s), hz).abs() < 0.05);
        }
    }

    #[test]
    fn soloing_the_low_band_keeps_the_bass_and_drops_the_mids() {
        let mut block = solo(&[Band::Low]);
        assert!(measured_gain_db(|s| block.process(s), 40.0).abs() < 0.5);
        let mut block = solo(&[Band::Low]);
        assert!(measured_gain_db(|s| block.process(s), 1500.0) < -40.0);
    }

    #[test]
    fn soloing_the_mid_band_centres_on_it_and_follows_a_moved_split() {
        let mut block = solo(&[Band::Mid]);
        assert!(measured_gain_db(|s| block.process(s), 1100.0).abs() < 1.0);
        assert!(measured_gain_db(|s| block.process(s), 60.0) < -30.0);

        let mut block = solo(&[Band::Mid]);
        block.set(ParamId::BandSplit3Hz, 1200.0);
        assert!(measured_gain_db(|s| block.process(s), 4000.0) < -15.0);
    }

    #[test]
    fn a_crossover_pair_sums_to_unity_magnitude() {
        let mut crossover = Crossover::new(1000.0, RATE);
        let mut high = vec![0.0; 256];
        let gain = measured_gain_db(
            |s| {
                let high = &mut high[..s.len()];
                crossover.split(s, high);
                for (low, h) in s.iter_mut().zip(high.iter()) {
                    *low += h;
                }
            },
            1000.0,
        );
        assert!(gain.abs() < 0.01, "{gain}");
    }
}
