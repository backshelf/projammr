//! Second-order filters for every block that equalises or splits.
//!
//! Coefficients follow R. Bristow-Johnson, "Cookbook formulae for audio EQ
//! biquad filter coefficients"
//! (<https://www.w3.org/TR/audio-eq-cookbook/>). Filters run in direct form II
//! transposed in `f64`, so a 20 Hz high-pass at 48 kHz keeps its precision.

use std::f64::consts::PI;

use super::CHANNELS;
use super::params::choices;

/// Q of a second-order Butterworth section, and of each half of a
/// Linkwitz-Riley 4th-order filter.
pub const BUTTERWORTH_Q: f32 = std::f32::consts::FRAC_1_SQRT_2;

choices! {
    /// The shape of one EQ band.
    pub enum FilterKind {
        /// Passes the signal unchanged.
        Off,
        Peaking,
        LowShelf,
        HighShelf,
        LowPass,
        HighPass,
    }
}

impl FilterKind {
    /// The coefficients of this shape. `gain_db` only affects the peaking and
    /// shelf shapes.
    pub fn design(self, hz: f32, gain_db: f32, q: f32, rate: f32) -> Coefs {
        let d = Design::new(hz, q, rate);
        let a = 10f64.powf(f64::from(gain_db) / 40.0);
        match self {
            FilterKind::Off => Coefs::IDENTITY,
            FilterKind::Peaking => d.normalise(
                [1.0 + d.alpha * a, -2.0 * d.cos, 1.0 - d.alpha * a],
                [1.0 + d.alpha / a, -2.0 * d.cos, 1.0 - d.alpha / a],
            ),
            FilterKind::LowShelf => {
                let k = 2.0 * a.sqrt() * d.alpha;
                d.normalise(
                    [
                        a * ((a + 1.0) - (a - 1.0) * d.cos + k),
                        2.0 * a * ((a - 1.0) - (a + 1.0) * d.cos),
                        a * ((a + 1.0) - (a - 1.0) * d.cos - k),
                    ],
                    [
                        (a + 1.0) + (a - 1.0) * d.cos + k,
                        -2.0 * ((a - 1.0) + (a + 1.0) * d.cos),
                        (a + 1.0) + (a - 1.0) * d.cos - k,
                    ],
                )
            }
            FilterKind::HighShelf => {
                let k = 2.0 * a.sqrt() * d.alpha;
                d.normalise(
                    [
                        a * ((a + 1.0) + (a - 1.0) * d.cos + k),
                        -2.0 * a * ((a - 1.0) + (a + 1.0) * d.cos),
                        a * ((a + 1.0) + (a - 1.0) * d.cos - k),
                    ],
                    [
                        (a + 1.0) - (a - 1.0) * d.cos + k,
                        2.0 * ((a - 1.0) - (a + 1.0) * d.cos),
                        (a + 1.0) - (a - 1.0) * d.cos - k,
                    ],
                )
            }
            FilterKind::LowPass => Coefs::low_pass(hz, q, rate),
            FilterKind::HighPass => Coefs::high_pass(hz, q, rate),
        }
    }
}

/// The shared terms of every cookbook design.
struct Design {
    cos: f64,
    alpha: f64,
}

impl Design {
    fn new(hz: f32, q: f32, rate: f32) -> Self {
        // Just under Nyquist, where the bilinear transform still has room.
        let hz = f64::from(hz).clamp(1.0, 0.49 * f64::from(rate));
        let w0 = 2.0 * PI * hz / f64::from(rate);
        Self {
            cos: w0.cos(),
            alpha: w0.sin() / (2.0 * f64::from(q.max(0.01))),
        }
    }

    fn denominator(&self) -> [f64; 3] {
        [1.0 + self.alpha, -2.0 * self.cos, 1.0 - self.alpha]
    }

    fn normalise(&self, b: [f64; 3], a: [f64; 3]) -> Coefs {
        Coefs {
            b0: b[0] / a[0],
            b1: b[1] / a[0],
            b2: b[2] / a[0],
            a1: a[1] / a[0],
            a2: a[2] / a[0],
        }
    }
}

/// Normalised biquad coefficients (`a0 = 1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coefs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

impl Coefs {
    pub const IDENTITY: Coefs = Coefs {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };

    pub fn low_pass(hz: f32, q: f32, rate: f32) -> Coefs {
        let d = Design::new(hz, q, rate);
        let b = (1.0 - d.cos) / 2.0;
        d.normalise([b, 2.0 * b, b], d.denominator())
    }

    pub fn high_pass(hz: f32, q: f32, rate: f32) -> Coefs {
        let d = Design::new(hz, q, rate);
        let b = (1.0 + d.cos) / 2.0;
        d.normalise([b, -2.0 * b, b], d.denominator())
    }

    pub fn all_pass(hz: f32, q: f32, rate: f32) -> Coefs {
        let d = Design::new(hz, q, rate);
        let a = d.denominator();
        d.normalise([a[2], a[1], a[0]], a)
    }

    /// The magnitude response at `hz`, as a linear gain.
    pub fn magnitude(&self, hz: f32, rate: f32) -> f64 {
        let w = 2.0 * PI * f64::from(hz) / f64::from(rate);
        let (c1, s1, c2, s2) = (w.cos(), w.sin(), (2.0 * w).cos(), (2.0 * w).sin());
        let num = (self.b0 + self.b1 * c1 + self.b2 * c2).hypot(-self.b1 * s1 - self.b2 * s2);
        let den = (1.0 + self.a1 * c1 + self.a2 * c2).hypot(-self.a1 * s1 - self.a2 * s2);
        num / den
    }

    /// One direct form II transposed step of `x` through these coefficients,
    /// with `state` the filter's two delay elements.
    #[inline]
    pub fn tick(&self, x: f64, state: &mut [f64; 2]) -> f64 {
        let y = self.b0 * x + state[0];
        state[0] = self.b1 * x - self.a1 * y + state[1];
        state[1] = self.b2 * x - self.a2 * y;
        y
    }

    fn lerp(&self, to: &Coefs, t: f64) -> Coefs {
        let mix = |a: f64, b: f64| a + (b - a) * t;
        Coefs {
            b0: mix(self.b0, to.b0),
            b1: mix(self.b1, to.b1),
            b2: mix(self.b2, to.b2),
            a1: mix(self.a1, to.a1),
            a2: mix(self.a2, to.a2),
        }
    }
}

/// One stereo biquad. A new target is reached by cross-fading the
/// coefficients across the next `process` call, which keeps a moving
/// parameter free of zipper noise.
#[derive(Clone, Debug)]
pub struct Biquad {
    current: Coefs,
    target: Coefs,
    state: [[f64; 2]; CHANNELS],
}

impl Biquad {
    pub fn new(coefs: Coefs) -> Self {
        Self {
            current: coefs,
            target: coefs,
            state: [[0.0; 2]; CHANNELS],
        }
    }

    pub fn set(&mut self, coefs: Coefs) {
        self.target = coefs;
    }

    /// The coefficients the filter is at or fading to.
    pub fn target(&self) -> &Coefs {
        &self.target
    }

    /// Clears the filter memory and lands on the target at once.
    pub fn reset(&mut self) {
        self.current = self.target;
        self.state = [[0.0; 2]; CHANNELS];
    }

    /// Whether the filter passes its input unchanged and is not fading.
    pub fn is_identity(&self) -> bool {
        self.current == Coefs::IDENTITY && self.target == Coefs::IDENTITY
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        let frames = samples.len() / CHANNELS;
        if self.current == self.target {
            let c = self.current;
            for frame in samples.chunks_exact_mut(CHANNELS) {
                self.tick(&c, frame);
            }
            return;
        }
        let from = self.current;
        for (i, frame) in samples.chunks_exact_mut(CHANNELS).enumerate() {
            let c = from.lerp(&self.target, (i + 1) as f64 / frames as f64);
            self.tick(&c, frame);
        }
        self.current = self.target;
    }

    #[inline]
    fn tick(&mut self, c: &Coefs, frame: &mut [f32]) {
        for (sample, state) in frame.iter_mut().zip(&mut self.state) {
            *sample = c.tick(f64::from(*sample), state) as f32;
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const RATE: f32 = 48_000.0;

    /// The steady-state gain, in dB, `process` applies to a stereo sine at `hz`.
    pub fn measured_gain_db(mut process: impl FnMut(&mut [f32]), hz: f32) -> f64 {
        let frames = RATE as usize;
        let mut samples: Vec<f32> = (0..frames)
            .flat_map(|i| {
                let v = (2.0 * std::f64::consts::PI * f64::from(hz) * i as f64 / f64::from(RATE))
                    .sin() as f32;
                [v * 0.5, v * 0.5]
            })
            .collect();
        for chunk in samples.chunks_mut(128 * CHANNELS) {
            process(chunk);
        }
        let tail = &samples[samples.len() / 2..];
        let rms =
            (tail.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
        20.0 * (rms / (0.5 / 2f64.sqrt())).log10()
    }

    fn db(gain: f64) -> f64 {
        20.0 * gain.log10()
    }

    #[test]
    fn a_peaking_band_reaches_its_gain_at_its_centre_and_little_elsewhere() {
        let c = FilterKind::Peaking.design(1000.0, 6.0, 0.9, RATE);
        assert!((db(c.magnitude(1000.0, RATE)) - 6.0).abs() < 0.01);
        assert!(db(c.magnitude(50.0, RATE)).abs() < 0.2);
        assert!(db(c.magnitude(15_000.0, RATE)).abs() < 0.3);
    }

    #[test]
    fn shelves_settle_at_their_gain_on_their_side() {
        let low = FilterKind::LowShelf.design(100.0, -6.0, BUTTERWORTH_Q, RATE);
        assert!((db(low.magnitude(20.0, RATE)) + 6.0).abs() < 0.2);
        assert!(db(low.magnitude(5000.0, RATE)).abs() < 0.05);
        let high = FilterKind::HighShelf.design(8000.0, 4.0, BUTTERWORTH_Q, RATE);
        assert!((db(high.magnitude(20_000.0, RATE)) - 4.0).abs() < 0.3);
        assert!(db(high.magnitude(100.0, RATE)).abs() < 0.05);
    }

    #[test]
    fn passes_are_3_db_down_at_their_corner_and_roll_off_12_db_per_octave() {
        let lp = FilterKind::LowPass.design(1000.0, 0.0, BUTTERWORTH_Q, RATE);
        assert!((db(lp.magnitude(1000.0, RATE)) + 3.01).abs() < 0.05);
        assert!((db(lp.magnitude(8000.0, RATE)) + 36.0).abs() < 2.0);
        let hp = FilterKind::HighPass.design(1000.0, 0.0, BUTTERWORTH_Q, RATE);
        assert!((db(hp.magnitude(1000.0, RATE)) + 3.01).abs() < 0.05);
        assert!((db(hp.magnitude(250.0, RATE)) + 24.0).abs() < 0.5);
    }

    #[test]
    fn an_all_pass_keeps_every_magnitude() {
        let ap = Coefs::all_pass(700.0, BUTTERWORTH_Q, RATE);
        for hz in [20.0, 700.0, 5000.0, 20_000.0] {
            assert!(db(ap.magnitude(hz, RATE)).abs() < 1e-9);
        }
    }

    #[test]
    fn off_and_zero_gain_bands_are_the_identity() {
        assert_eq!(
            FilterKind::Off.design(20.0, 12.0, 0.9, RATE),
            Coefs::IDENTITY
        );
        let flat = FilterKind::Peaking.design(1000.0, 0.0, 0.9, RATE);
        assert!(db(flat.magnitude(1000.0, RATE)).abs() < 1e-9);
    }

    #[test]
    fn the_running_filter_matches_its_designed_response() {
        let c = FilterKind::Peaking.design(2000.0, -9.0, 2.0, RATE);
        let mut filter = Biquad::new(c);
        let gain = measured_gain_db(|s| filter.process(s), 2000.0);
        assert!((gain + 9.0).abs() < 0.05, "{gain}");
    }

    #[test]
    fn a_new_target_is_reached_by_the_end_of_the_next_call() {
        let mut filter = Biquad::new(Coefs::IDENTITY);
        let target = FilterKind::Peaking.design(500.0, 12.0, 1.0, RATE);
        filter.set(target);
        let mut block = [0.0f32; 256];
        filter.process(&mut block);
        assert_eq!(filter.current, target);
        assert!(!filter.is_identity());
    }
}
