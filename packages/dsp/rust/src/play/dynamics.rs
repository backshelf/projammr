//! A feed-forward, log-domain, stereo-linked compressor with a soft knee and
//! a smooth-branching peak detector, after D. Giannoulis, M. Massberg and
//! J. D. Reiss, "Digital dynamic range compressor design — a tutorial and
//! analysis", JAES 60(6), 2012 (<https://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf>).

use super::params::{MeterId, ParamId};
use super::{Block, CHANNELS, db_to_gain};

/// A compressor's settings, in the units the parameters use.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub threshold_db: f32,
    pub ratio: f32,
    pub knee_db: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    pub makeup_db: f32,
}

pub struct Compressor {
    rate: f32,
    settings: Settings,
    attack_coef: f32,
    release_coef: f32,
    /// The smoothed gain reduction, in dB (0 or more).
    state_db: f32,
}

impl Compressor {
    pub fn new(rate: f32, settings: Settings) -> Self {
        let mut compressor = Self {
            rate,
            settings,
            attack_coef: 0.0,
            release_coef: 0.0,
            state_db: 0.0,
        };
        compressor.apply(settings);
        compressor
    }

    /// A compressor at the parameter table's defaults.
    pub fn with_defaults(rate: f32) -> Self {
        let default = |param: ParamId| param.spec().domain.default_value();
        Self::new(
            rate,
            Settings {
                threshold_db: default(ParamId::CompThresholdDb),
                ratio: default(ParamId::CompRatio),
                knee_db: default(ParamId::CompKneeDb),
                attack_ms: default(ParamId::CompAttackMs),
                release_ms: default(ParamId::CompReleaseMs),
                makeup_db: default(ParamId::CompMakeupDb),
            },
        )
    }

    pub fn apply(&mut self, settings: Settings) {
        self.settings = settings;
        self.attack_coef = time_coef(settings.attack_ms, self.rate);
        self.release_coef = time_coef(settings.release_ms, self.rate);
    }

    /// The current gain reduction, in dB (0 or more).
    pub fn gain_reduction_db(&self) -> f32 {
        self.state_db
    }

    /// The static curve: the output level, in dB, for an input level `x_db`.
    fn gain_computer(&self, x_db: f32) -> f32 {
        let Settings {
            threshold_db,
            ratio,
            knee_db,
            ..
        } = self.settings;
        let over = x_db - threshold_db;
        let half = knee_db * 0.5;
        if over <= -half {
            x_db
        } else if over < half {
            x_db + (1.0 / ratio - 1.0) * (over + half).powi(2) / (2.0 * knee_db)
        } else {
            threshold_db + over / ratio
        }
    }
}

/// The one-pole coefficient whose time constant is `ms`.
fn time_coef(ms: f32, rate: f32) -> f32 {
    (-1.0 / (ms * 1e-3 * rate)).exp()
}

impl Block for Compressor {
    fn set(&mut self, param: ParamId, value: f32) {
        let mut settings = self.settings;
        match param {
            ParamId::CompThresholdDb => settings.threshold_db = value,
            ParamId::CompRatio => settings.ratio = value,
            ParamId::CompKneeDb => settings.knee_db = value,
            ParamId::CompAttackMs => settings.attack_ms = value,
            ParamId::CompReleaseMs => settings.release_ms = value,
            _ => settings.makeup_db = value,
        }
        self.apply(settings);
    }

    fn process(&mut self, samples: &mut [f32]) {
        for frame in samples.chunks_exact_mut(CHANNELS) {
            let peak = frame[0].abs().max(frame[1].abs()).max(1e-9);
            let x_db = 20.0 * peak.log10();
            let wanted = x_db - self.gain_computer(x_db);
            let coef = if wanted > self.state_db {
                self.attack_coef
            } else {
                self.release_coef
            };
            self.state_db = coef * self.state_db + (1.0 - coef) * wanted;
            let gain = db_to_gain(self.settings.makeup_db - self.state_db);
            frame[0] *= gain;
            frame[1] *= gain;
        }
    }

    fn reset(&mut self) {
        self.state_db = 0.0;
    }

    fn meter(&self, meter: MeterId) -> Option<f32> {
        (meter == MeterId::GainReductionDb).then_some(self.state_db)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn compressor(threshold_db: f32, ratio: f32, attack_ms: f32, release_ms: f32) -> Compressor {
        Compressor::new(
            RATE,
            Settings {
                threshold_db,
                ratio,
                knee_db: 0.0,
                attack_ms,
                release_ms,
                makeup_db: 0.0,
            },
        )
    }

    fn sine(amplitude: f32, hz: f32, seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE) as usize)
            .flat_map(|i| {
                let v = amplitude * (std::f32::consts::TAU * hz * i as f32 / RATE).sin();
                [v, v]
            })
            .collect()
    }

    fn peak_db(samples: &[f32]) -> f32 {
        20.0 * samples.iter().fold(0f32, |m, v| m.max(v.abs())).log10()
    }

    #[test]
    fn a_sine_12_db_over_the_threshold_at_ratio_4_settles_3_db_over() {
        // −6 dBFS against −18 dB: 12 dB over, reduced to 3 dB, so −15 dBFS.
        // A long release holds the detector at the sine's peaks.
        let mut comp = compressor(-18.0, 4.0, 1.0, 2000.0);
        let mut samples = sine(db_to_gain(-6.0), 1000.0, 2.0);
        for chunk in samples.chunks_mut(256) {
            comp.process(chunk);
        }
        let settled = peak_db(&samples[samples.len() - 9600..]);
        assert!((settled + 15.0).abs() < 0.2, "{settled}");
        assert!((comp.gain_reduction_db() - 9.0).abs() < 0.2);
    }

    #[test]
    fn a_step_reaches_90_percent_of_its_reduction_after_ln_10_attack_times() {
        let attack_ms = 10.0;
        let mut comp = compressor(-20.0, 10.0, attack_ms, 100.0);
        let target = 18.0; // 20 dB over at ratio 10 wants 18 dB of reduction.
        let mut frame = [1.0f32, 1.0];
        let mut reached = None;
        for i in 0..(RATE as usize) {
            frame.fill(1.0);
            comp.process(&mut frame);
            if comp.gain_reduction_db() >= 0.9 * target {
                reached = Some(i + 1);
                break;
            }
        }
        let expected = std::f32::consts::LN_10 * attack_ms * 1e-3 * RATE;
        let reached = reached.expect("never reached 90 %") as f32;
        assert!((reached - expected).abs() <= 2.0, "{reached} vs {expected}");
    }

    #[test]
    fn a_signal_under_the_threshold_is_unchanged() {
        let mut comp = Compressor::with_defaults(RATE);
        let original = sine(db_to_gain(-30.0), 440.0, 0.5);
        let mut samples = original.clone();
        comp.process(&mut samples);
        for (a, b) in samples.iter().zip(&original) {
            assert!((a - b).abs() < 1e-6);
        }
        assert_eq!(comp.meter(MeterId::GainReductionDb), Some(0.0));
    }

    #[test]
    fn the_soft_knee_bends_smoothly_through_the_threshold() {
        let mut comp = Compressor::with_defaults(RATE);
        comp.set(ParamId::CompKneeDb, 6.0);
        comp.set(ParamId::CompRatio, 4.0);
        let t = comp.settings.threshold_db;
        assert_eq!(comp.gain_computer(t - 3.0), t - 3.0);
        assert!((comp.gain_computer(t + 3.0) - (t + 0.75)).abs() < 1e-4);
        let middle = comp.gain_computer(t);
        assert!(middle < t && middle > t - 1.0, "{middle}");
    }

    #[test]
    fn makeup_gain_lifts_the_output() {
        let mut comp = compressor(0.0, 1.0, 10.0, 100.0);
        comp.set(ParamId::CompMakeupDb, 6.0);
        let mut frame = [0.1f32, -0.1];
        comp.process(&mut frame);
        assert!((frame[0] - 0.1 * db_to_gain(6.0)).abs() < 1e-5);
    }
}
