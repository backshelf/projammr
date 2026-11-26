//! The last gain before the meters: a −20 dB dim, a ±12 dB trim, and the
//! offset that normalises a version to a loudness target (the host sets it to
//! `target − measured LUFS`). A change ramps across the next call.

use super::params::ParamId;
use super::{Block, db_to_gain, ramp_step};

const DIM_DB: f32 = -20.0;

pub struct Gain {
    dim: bool,
    trim_db: f32,
    normalise_db: f32,
    applied: f32,
}

impl Gain {
    pub fn new() -> Self {
        let default = |param: ParamId| param.spec().domain.default_value();
        let mut gain = Self {
            dim: default(ParamId::GainDim) == 1.0,
            trim_db: default(ParamId::GainTrimDb),
            normalise_db: default(ParamId::GainNormaliseDb),
            applied: 1.0,
        };
        gain.applied = gain.target();
        gain
    }

    fn target(&self) -> f32 {
        let dim = if self.dim { DIM_DB } else { 0.0 };
        db_to_gain(dim + self.trim_db + self.normalise_db)
    }
}

impl Default for Gain {
    fn default() -> Self {
        Self::new()
    }
}

impl Block for Gain {
    fn set(&mut self, param: ParamId, value: f32) {
        match param {
            ParamId::GainDim => self.dim = value == 1.0,
            ParamId::GainTrimDb => self.trim_db = value,
            _ => self.normalise_db = value,
        }
    }

    fn process(&mut self, samples: &mut [f32]) {
        let target = self.target();
        if self.applied == target {
            if target != 1.0 {
                samples.iter_mut().for_each(|s| *s *= target);
            }
            return;
        }
        let frames = samples.len() / super::CHANNELS;
        let step = ramp_step(self.applied, target, frames);
        for (i, frame) in samples.chunks_exact_mut(super::CHANNELS).enumerate() {
            let gain = self.applied + step * (i + 1) as f32;
            frame.iter_mut().for_each(|s| *s *= gain);
        }
        self.applied = target;
    }

    fn reset(&mut self) {
        self.applied = self.target();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_by_default_leaves_samples_untouched() {
        let mut gain = Gain::new();
        let mut samples = [0.3f32, -0.7];
        gain.process(&mut samples);
        assert_eq!(samples, [0.3, -0.7]);
    }

    #[test]
    fn dim_trim_and_normalise_add_in_db_and_ramp_in() {
        let mut gain = Gain::new();
        gain.set(ParamId::GainDim, 1.0);
        gain.set(ParamId::GainTrimDb, 6.0);
        gain.set(ParamId::GainNormaliseDb, -4.0);
        let mut ramp = [1.0f32; 256];
        gain.process(&mut ramp);
        let target = db_to_gain(-18.0);
        assert!(ramp[0] > 0.9, "{}", ramp[0]);
        assert!((ramp[255] - target).abs() < 1e-6);
        let mut steady = [1.0f32; 4];
        gain.process(&mut steady);
        assert!((steady[3] - target).abs() < 1e-6);
    }
}
