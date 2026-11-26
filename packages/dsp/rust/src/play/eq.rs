//! The EQ: eight parametric bands, or a 31-band 1/3-octave curve in their
//! place. Built on the RBJ cookbook biquads in [`super::biquad`]; switching
//! between the two sets cross-fades like any other coefficient change.

use super::Block;
use super::biquad::{Biquad, Coefs, FilterKind};
use super::params::{EQ_BAND_FIELDS, ParamId};

pub const BANDS: usize = 8;

/// The ISO 1/3-octave centres a curve's gains apply to.
pub const CURVE_CENTRES_HZ: [f32; 31] = [
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0, 250.0, 315.0, 400.0,
    500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0, 2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0,
    8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
];

/// Q of a peaking band one third of an octave wide.
const CURVE_Q: f32 = 4.3;
const CURVE_LIMIT_DB: f32 = 12.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EqBand {
    pub kind: FilterKind,
    pub hz: f32,
    pub gain_db: f32,
    pub q: f32,
}

pub struct Eq {
    rate: f32,
    bands: [EqBand; BANDS],
    parametric: [Biquad; BANDS],
    curve: [Biquad; CURVE_CENTRES_HZ.len()],
    curve_gains: Option<[f32; CURVE_CENTRES_HZ.len()]>,
}

impl Eq {
    pub fn new(rate: f32, bands: [EqBand; BANDS]) -> Self {
        let mut eq = Self {
            rate,
            bands,
            parametric: std::array::from_fn(|_| Biquad::new(Coefs::IDENTITY)),
            curve: std::array::from_fn(|_| Biquad::new(Coefs::IDENTITY)),
            curve_gains: None,
        };
        eq.retarget();
        eq.reset();
        eq
    }

    /// An EQ at the parameter table's defaults.
    pub fn with_defaults(rate: f32) -> Self {
        let bands = std::array::from_fn(|band| {
            let field = |offset: usize| {
                let id = ParamId::Eq1Kind as usize + band * EQ_BAND_FIELDS + offset;
                ParamId::ALL[id].spec().domain.default_value()
            };
            EqBand {
                kind: FilterKind::from_value(field(0)),
                hz: field(1),
                gain_db: field(2),
                q: field(3),
            }
        });
        Self::new(rate, bands)
    }

    pub fn set_band(&mut self, index: usize, band: EqBand) {
        self.bands[index] = band;
        self.retarget();
    }

    /// Replaces the parametric bands with 31 peaking bands at
    /// [`CURVE_CENTRES_HZ`], each gain clamped to ±12 dB, or restores the
    /// parametric bands when `gains` is `None`.
    pub fn set_curve(&mut self, gains: Option<&[f32; CURVE_CENTRES_HZ.len()]>) {
        self.curve_gains = gains.map(|g| g.map(|db| db.clamp(-CURVE_LIMIT_DB, CURVE_LIMIT_DB)));
        self.retarget();
    }

    /// Points every filter at its design; the set not in use targets the
    /// identity, so it fades out and then costs nothing.
    fn retarget(&mut self) {
        let curve = self.curve_gains;
        for (filter, band) in self.parametric.iter_mut().zip(&self.bands) {
            filter.set(match curve {
                Some(_) => Coefs::IDENTITY,
                None => band.kind.design(band.hz, band.gain_db, band.q, self.rate),
            });
        }
        for (i, filter) in self.curve.iter_mut().enumerate() {
            filter.set(match curve {
                Some(gains) => {
                    FilterKind::Peaking.design(CURVE_CENTRES_HZ[i], gains[i], CURVE_Q, self.rate)
                }
                None => Coefs::IDENTITY,
            });
        }
    }

    /// The designed magnitude response at `hz`, in dB.
    pub fn response_db(&self, hz: f32) -> f64 {
        let gain: f64 = self
            .parametric
            .iter()
            .chain(&self.curve)
            .map(|filter| filter.target().magnitude(hz, self.rate))
            .product();
        20.0 * gain.log10()
    }
}

impl Block for Eq {
    fn set(&mut self, param: ParamId, value: f32) {
        let offset = param as usize - ParamId::Eq1Kind as usize;
        let band = &mut self.bands[offset / EQ_BAND_FIELDS];
        match offset % EQ_BAND_FIELDS {
            0 => band.kind = FilterKind::from_value(value),
            1 => band.hz = value,
            2 => band.gain_db = value,
            _ => band.q = value,
        }
        self.retarget();
    }

    fn process(&mut self, samples: &mut [f32]) {
        for filter in self.parametric.iter_mut().chain(&mut self.curve) {
            if !filter.is_identity() {
                filter.process(samples);
            }
        }
    }

    fn reset(&mut self) {
        for filter in self.parametric.iter_mut().chain(&mut self.curve) {
            filter.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::biquad::tests::{RATE, measured_gain_db};

    #[test]
    fn the_defaults_are_flat() {
        let mut eq = Eq::with_defaults(RATE);
        for hz in [30.0, 1000.0, 15_000.0] {
            assert!(eq.response_db(hz).abs() < 1e-6);
        }
        assert!(measured_gain_db(|s| eq.process(s), 440.0).abs() < 0.01);
    }

    #[test]
    fn setting_a_band_through_its_parameters_shapes_the_response() {
        let mut eq = Eq::with_defaults(RATE);
        eq.set(ParamId::Eq5GainDb, 6.0);
        eq.set(ParamId::Eq5Q, 2.0);
        assert!((eq.response_db(1000.0) - 6.0).abs() < 0.05);
        assert!(eq.response_db(100.0).abs() < 0.1);
        let gain = measured_gain_db(|s| eq.process(s), 1000.0);
        assert!((gain - 6.0).abs() < 0.1, "{gain}");
    }

    #[test]
    fn a_high_pass_band_removes_the_lows() {
        let mut eq = Eq::with_defaults(RATE);
        eq.set(ParamId::Eq1Kind, FilterKind::HighPass as u8 as f32);
        eq.set(ParamId::Eq1Hz, 200.0);
        assert!(eq.response_db(50.0) < -20.0);
        assert!(eq.response_db(2000.0).abs() < 0.1);
    }

    #[test]
    fn a_curve_replaces_the_bands_and_clamps_its_gains() {
        let mut eq = Eq::with_defaults(RATE);
        eq.set(ParamId::Eq5GainDb, 9.0);
        let mut gains = [0.0; 31];
        gains[21] = 30.0; // 2.5 kHz, beyond the limit
        eq.set_curve(Some(&gains));
        assert!(eq.response_db(1000.0).abs() < 0.5);
        assert!((eq.response_db(2500.0) - CURVE_LIMIT_DB as f64).abs() < 0.5);

        eq.set_curve(None);
        assert!((eq.response_db(1000.0) - 9.0).abs() < 0.2);
        assert!(eq.response_db(2500.0) < 9.0);
    }

    #[test]
    fn switching_to_a_curve_fades_rather_than_jumps() {
        let mut eq = Eq::with_defaults(RATE);
        let mut samples = vec![0.25f32; 256];
        eq.process(&mut samples);
        let mut gains = [0.0; 31];
        gains[0] = 12.0;
        eq.set_curve(Some(&gains));
        let mut block = vec![0.25f32; 256];
        eq.process(&mut block);
        // The first frame after the change is still close to the old output.
        assert!((block[0] - 0.25).abs() < 0.01, "{}", block[0]);
    }
}
