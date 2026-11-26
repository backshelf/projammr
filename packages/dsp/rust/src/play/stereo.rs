//! The stereo auditions: the right channel's polarity, mid/side width, and a
//! mode that plays the mix, its mono sum, its mid, its side or one channel.
//! It also keeps the live correlation of what it outputs.

use std::f32::consts::FRAC_1_SQRT_2;

use super::params::{MeterId, ParamId, choices};
use super::{Block, CHANNELS, ramp_step};

/// The correlation meter's time constant.
const CORRELATION_SECONDS: f32 = 0.3;

choices! {
    /// What the stereo block plays.
    pub enum StereoMode {
        Stereo,
        /// The equal-power sum of both channels in both.
        Mono,
        /// The mid signal alone, in both channels.
        Mid,
        /// The side signal alone, opposite in each channel.
        Side,
        Left,
        Right,
    }
}

impl StereoMode {
    /// The output frame for an input frame, with the side scaled by `width`.
    #[inline]
    pub fn apply(self, left: f32, right: f32, width: f32) -> [f32; CHANNELS] {
        let mid = (left + right) * 0.5;
        let side = (left - right) * 0.5 * width;
        match self {
            StereoMode::Stereo => [mid + side, mid - side],
            StereoMode::Mono => {
                let sum = (left + right) * FRAC_1_SQRT_2;
                [sum, sum]
            }
            StereoMode::Mid => [mid, mid],
            StereoMode::Side => [side, -side],
            StereoMode::Left => [left, left],
            StereoMode::Right => [right, right],
        }
    }
}

pub struct Stereo {
    mode: StereoMode,
    /// The mode faded out of across the next call.
    previous_mode: StereoMode,
    width: f32,
    applied_width: f32,
    invert_right: bool,
    applied_polarity: f32,
    correlation: Correlation,
}

impl Stereo {
    pub fn new(rate: f32) -> Self {
        let default = |param: ParamId| param.spec().domain.default_value();
        let mode = StereoMode::from_value(default(ParamId::StereoMode));
        let width = default(ParamId::StereoWidth);
        let invert_right = default(ParamId::StereoInvertRight) == 1.0;
        Self {
            mode,
            previous_mode: mode,
            width,
            applied_width: width,
            invert_right,
            applied_polarity: polarity(invert_right),
            correlation: Correlation::new(rate),
        }
    }
}

fn polarity(invert: bool) -> f32 {
    if invert { -1.0 } else { 1.0 }
}

impl Block for Stereo {
    fn set(&mut self, param: ParamId, value: f32) {
        match param {
            ParamId::StereoMode => self.mode = StereoMode::from_value(value),
            ParamId::StereoWidth => self.width = value,
            _ => self.invert_right = value == 1.0,
        }
    }

    fn process(&mut self, samples: &mut [f32]) {
        let frames = samples.len() / CHANNELS;
        let width_step = ramp_step(self.applied_width, self.width, frames);
        let target_polarity = polarity(self.invert_right);
        let polarity_step = ramp_step(self.applied_polarity, target_polarity, frames);
        let fade = self.previous_mode != self.mode;

        for (i, frame) in samples.chunks_exact_mut(CHANNELS).enumerate() {
            let step = (i + 1) as f32;
            let width = self.applied_width + width_step * step;
            let right = frame[1] * (self.applied_polarity + polarity_step * step);
            let mut out = self.mode.apply(frame[0], right, width);
            if fade {
                let t = step / frames as f32;
                let old = self.previous_mode.apply(frame[0], right, width);
                out = [
                    old[0] + (out[0] - old[0]) * t,
                    old[1] + (out[1] - old[1]) * t,
                ];
            }
            frame.copy_from_slice(&out);
            self.correlation.push(out[0], out[1]);
        }

        self.applied_width = self.width;
        self.applied_polarity = target_polarity;
        self.previous_mode = self.mode;
    }

    fn reset(&mut self) {
        self.correlation.reset();
    }

    fn meter(&self, meter: MeterId) -> Option<f32> {
        (meter == MeterId::Correlation).then(|| self.correlation.value())
    }
}

/// Pearson correlation of the two channels over an exponential window: 1 for
/// mono, 0 for unrelated channels, −1 for one channel inverted.
pub struct Correlation {
    /// In `f64`: a 300 ms average moves by parts in 10⁵ per sample, which `f32`
    /// rounds away.
    coef: f64,
    lr: f64,
    ll: f64,
    rr: f64,
}

impl Correlation {
    pub fn new(rate: f32) -> Self {
        Self {
            coef: (-1.0 / f64::from(CORRELATION_SECONDS * rate)).exp(),
            lr: 0.0,
            ll: 0.0,
            rr: 0.0,
        }
    }

    #[inline]
    pub fn push(&mut self, left: f32, right: f32) {
        let (left, right) = (f64::from(left), f64::from(right));
        let k = 1.0 - self.coef;
        self.lr += k * (left * right - self.lr);
        self.ll += k * (left * left - self.ll);
        self.rr += k * (right * right - self.rr);
    }

    /// The correlation, or 0 while the signal is silent.
    pub fn value(&self) -> f32 {
        let power = (self.ll * self.rr).sqrt();
        if power < 1e-12 {
            0.0
        } else {
            (self.lr / power).clamp(-1.0, 1.0) as f32
        }
    }

    pub fn reset(&mut self) {
        self.lr = 0.0;
        self.ll = 0.0;
        self.rr = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn run(stereo: &mut Stereo, frame: [f32; 2]) -> [f32; 2] {
        // Two calls, so any fade from a parameter change has finished.
        let mut block = [frame[0], frame[1]].repeat(64);
        stereo.process(&mut block);
        let mut block = [frame[0], frame[1]].repeat(64);
        stereo.process(&mut block);
        [block[126], block[127]]
    }

    #[test]
    fn the_defaults_pass_the_signal_unchanged() {
        let mut stereo = Stereo::new(RATE);
        assert_eq!(run(&mut stereo, [0.25, -0.5]), [0.25, -0.5]);
    }

    #[test]
    fn each_mode_plays_what_it_names() {
        let (l, r) = (0.6f32, 0.2f32);
        let cases = [
            (StereoMode::Mono, [(l + r) * FRAC_1_SQRT_2; 2]),
            (StereoMode::Mid, [(l + r) / 2.0; 2]),
            (StereoMode::Side, [(l - r) / 2.0, -(l - r) / 2.0]),
            (StereoMode::Left, [l, l]),
            (StereoMode::Right, [r, r]),
        ];
        for (mode, expected) in cases {
            let mut stereo = Stereo::new(RATE);
            stereo.set(ParamId::StereoMode, mode as usize as f32);
            let out = run(&mut stereo, [l, r]);
            assert!((out[0] - expected[0]).abs() < 1e-6, "{mode:?} {out:?}");
            assert!((out[1] - expected[1]).abs() < 1e-6, "{mode:?} {out:?}");
        }
    }

    #[test]
    fn zero_width_collapses_to_the_mid_and_double_width_doubles_the_side() {
        let mut stereo = Stereo::new(RATE);
        stereo.set(ParamId::StereoWidth, 0.0);
        assert_eq!(run(&mut stereo, [1.0, 0.0]), [0.5, 0.5]);
        stereo.set(ParamId::StereoWidth, 2.0);
        assert_eq!(run(&mut stereo, [1.0, 0.0]), [1.5, -0.5]);
    }

    #[test]
    fn inverting_the_right_polarity_and_summing_to_mono_leaves_the_side() {
        let mut stereo = Stereo::new(RATE);
        stereo.set(ParamId::StereoInvertRight, 1.0);
        stereo.set(ParamId::StereoMode, StereoMode::Mono as usize as f32);
        let out = run(&mut stereo, [0.5, 0.5]);
        assert!(out[0].abs() < 1e-6);
    }

    #[test]
    fn correlation_reads_1_for_mono_and_minus_1_for_an_inverted_channel() {
        let sine = |i: usize| (i as f32 * 0.05).sin();
        let second = || -> Vec<f32> {
            (0..RATE as usize)
                .flat_map(|i| [sine(i), sine(i)])
                .collect()
        };
        let mut stereo = Stereo::new(RATE);
        for quantum in second().chunks_mut(256) {
            stereo.process(quantum);
        }
        assert!((stereo.meter(MeterId::Correlation).unwrap() - 1.0).abs() < 1e-3);

        stereo.set(ParamId::StereoInvertRight, 1.0);
        // Three seconds is ten time constants: the mono history has gone.
        for _ in 0..3 {
            for quantum in second().chunks_mut(256) {
                stereo.process(quantum);
            }
        }
        assert!((stereo.meter(MeterId::Correlation).unwrap() + 1.0).abs() < 1e-3);
        assert_eq!(stereo.meter(MeterId::GainReductionDb), None);
    }

    #[test]
    fn a_mode_change_fades_across_the_call() {
        let mut stereo = Stereo::new(RATE);
        let mut warm = [1.0f32, 0.0].repeat(64);
        stereo.process(&mut warm);
        stereo.set(ParamId::StereoMode, StereoMode::Right as usize as f32);
        let mut block = [1.0f32, 0.0].repeat(64);
        stereo.process(&mut block);
        assert!(block[0] > 0.9);
        assert_eq!(block[126], 0.0);
    }
}
