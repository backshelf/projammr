//! Device curves: an impression of how a mix sounds on a phone, a laptop,
//! earbuds, in a car, in a club or on the radio. Each device is a table of EQ
//! bands, a stereo treatment, and optionally a room or a compressor, applied
//! through private instances of the chain's own blocks.

use super::bands::Crossover;
use super::biquad::{BUTTERWORTH_Q, FilterKind};
use super::dynamics::{Compressor, Settings};
use super::eq::{BANDS, Eq, EqBand};
use super::params::{ParamId, choices};
use super::reverb::{Preset, Reverb};
use super::stereo::StereoMode;
use super::{Block, CHANNELS};

/// Q of the two sections of a 4th-order (24 dB per octave) Butterworth filter.
const Q4A: f32 = 0.5412;
const Q4B: f32 = 1.3066;
/// Q of a 2nd-order (12 dB per octave) Butterworth filter.
const Q2: f32 = BUTTERWORTH_Q;

/// Where a club's sub turns mono.
const CLUB_MONO_HZ: f32 = 120.0;

choices! {
    /// The playback device a curve imitates.
    pub enum Device {
        Phone,
        Laptop,
        Earbuds,
        Car,
        Club,
        Radio,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Image {
    /// Stereo, with the side scaled by the width.
    Width(f32),
    Mono,
    /// Mono below [`CLUB_MONO_HZ`], stereo above.
    MonoBass,
}

struct Profile {
    bands: &'static [EqBand],
    image: Image,
    room: Option<(Preset, f32)>,
    compressor: Option<Settings>,
}

const fn band(kind: FilterKind, hz: f32, gain_db: f32, q: f32) -> EqBand {
    EqBand {
        kind,
        hz,
        gain_db,
        q,
    }
}

const OFF: EqBand = band(FilterKind::Off, 1000.0, 0.0, 1.0);

impl Device {
    fn profile(self) -> Profile {
        use FilterKind::{HighPass, HighShelf, LowPass, LowShelf, Peaking};
        match self {
            Device::Phone => Profile {
                bands: const {
                    &[
                        band(HighPass, 400.0, 0.0, Q4A),
                        band(HighPass, 400.0, 0.0, Q4B),
                        band(Peaking, 2500.0, 4.0, 1.2),
                        band(LowPass, 8000.0, 0.0, Q2),
                    ]
                },
                image: Image::Mono,
                room: None,
                compressor: None,
            },
            Device::Laptop => Profile {
                bands: const {
                    &[
                        band(HighPass, 180.0, 0.0, Q2),
                        band(Peaking, 500.0, -3.0, 1.0),
                        band(Peaking, 4000.0, 3.0, 1.5),
                    ]
                },
                image: Image::Width(0.6),
                room: None,
                compressor: None,
            },
            Device::Earbuds => Profile {
                bands: const {
                    &[
                        band(LowShelf, 100.0, 2.0, Q2),
                        band(Peaking, 3000.0, -2.0, 2.0),
                        band(HighShelf, 9000.0, 3.0, Q2),
                    ]
                },
                image: Image::Width(1.0),
                room: None,
                compressor: None,
            },
            Device::Car => Profile {
                bands: const {
                    &[
                        band(LowShelf, 80.0, 4.0, Q2),
                        band(Peaking, 8000.0, 2.0, 0.9),
                        band(LowPass, 14_000.0, 0.0, Q2),
                    ]
                },
                image: Image::Width(0.8),
                room: Some((Preset::Room, 0.15)),
                compressor: None,
            },
            Device::Club => Profile {
                bands: const {
                    &[
                        band(LowShelf, 60.0, 5.0, Q2),
                        band(Peaking, 350.0, -2.0, 1.0),
                        band(HighPass, 35.0, 0.0, Q4A),
                        band(HighPass, 35.0, 0.0, Q4B),
                    ]
                },
                image: Image::MonoBass,
                room: Some((Preset::Club, 0.2)),
                compressor: None,
            },
            Device::Radio => Profile {
                bands: const {
                    &[
                        band(HighPass, 60.0, 0.0, Q2),
                        band(LowPass, 15_000.0, 0.0, Q2),
                    ]
                },
                image: Image::Width(1.0),
                room: None,
                compressor: Some(Settings {
                    threshold_db: -20.0,
                    ratio: 4.0,
                    knee_db: 6.0,
                    attack_ms: 1.0,
                    release_ms: 60.0,
                    makeup_db: 0.0,
                }),
            },
        }
    }
}

pub struct DeviceCurve {
    image: Image,
    eq: Eq,
    crossover: Crossover,
    high: Vec<f32>,
    room: Reverb,
    room_on: bool,
    compressor: Compressor,
    compressor_on: bool,
}

impl DeviceCurve {
    pub fn new(rate: f32, max_frames: usize) -> Self {
        let device = Device::from_value(ParamId::Device.spec().domain.default_value());
        let mut curve = Self {
            image: Image::Width(1.0),
            eq: Eq::new(rate, [OFF; BANDS]),
            crossover: Crossover::new(CLUB_MONO_HZ, rate),
            high: vec![0.0; max_frames * CHANNELS],
            room: Reverb::new(rate, Preset::Room, 0.0),
            room_on: false,
            compressor: Compressor::with_defaults(rate),
            compressor_on: false,
        };
        curve.select(device);
        curve.reset();
        curve
    }

    fn select(&mut self, device: Device) {
        let profile = device.profile();
        for index in 0..BANDS {
            self.eq
                .set_band(index, profile.bands.get(index).copied().unwrap_or(OFF));
        }
        self.image = profile.image;
        if let Some((preset, wet)) = profile.room {
            self.room.set_preset(preset);
            self.room.set(ParamId::ReverbWet, wet);
        }
        self.room_on = profile.room.is_some();
        if let Some(settings) = profile.compressor {
            self.compressor.apply(settings);
        }
        self.compressor_on = profile.compressor.is_some();
    }

    #[cfg(test)]
    fn response_db(&self, hz: f32) -> f64 {
        self.eq.response_db(hz)
    }
}

impl Block for DeviceCurve {
    fn set(&mut self, _param: ParamId, value: f32) {
        self.select(Device::from_value(value));
    }

    fn process(&mut self, samples: &mut [f32]) {
        self.eq.process(samples);
        if self.compressor_on {
            self.compressor.process(samples);
        }
        match self.image {
            Image::Width(width) => {
                if width != 1.0 {
                    for frame in samples.chunks_exact_mut(CHANNELS) {
                        let out = StereoMode::Stereo.apply(frame[0], frame[1], width);
                        frame.copy_from_slice(&out);
                    }
                }
            }
            Image::Mono => {
                for frame in samples.chunks_exact_mut(CHANNELS) {
                    let out = StereoMode::Mid.apply(frame[0], frame[1], 1.0);
                    frame.copy_from_slice(&out);
                }
            }
            Image::MonoBass => {
                let high = &mut self.high[..samples.len()];
                self.crossover.split(samples, high);
                for (frame, high) in samples
                    .chunks_exact_mut(CHANNELS)
                    .zip(high.chunks_exact(CHANNELS))
                {
                    let mid = StereoMode::Mid.apply(frame[0], frame[1], 1.0);
                    frame[0] = mid[0] + high[0];
                    frame[1] = mid[1] + high[1];
                }
            }
        }
        if self.room_on {
            self.room.process(samples);
        }
    }

    fn reset(&mut self) {
        self.eq.reset();
        self.crossover.reset();
        self.compressor.reset();
        self.room.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::biquad::tests::{RATE, measured_gain_db};

    fn curve(device: Device) -> DeviceCurve {
        let mut curve = DeviceCurve::new(RATE, 128);
        curve.set(ParamId::Device, device as usize as f32);
        curve.reset();
        curve
    }

    #[test]
    fn the_phone_has_no_lows_a_presence_peak_and_one_channel() {
        let mut phone = curve(Device::Phone);
        assert!(phone.response_db(100.0) < -40.0);
        assert!(phone.response_db(2500.0) > 3.0);
        assert!(phone.response_db(16_000.0) < -10.0);
        let mut frame = [1.0f32, 0.0].repeat(64);
        phone.process(&mut frame);
        assert_eq!(frame[126], frame[127]);
    }

    #[test]
    fn the_laptop_narrows_the_image() {
        let mut laptop = curve(Device::Laptop);
        let mut samples = [0.5f32, -0.5].repeat(4800);
        for chunk in samples.chunks_mut(256) {
            laptop.process(chunk);
        }
        let n = samples.len();
        // Pure side at width 0.6 keeps 60 % of its level, less the EQ at DC.
        assert!(samples[n - 2].abs() < 0.5 * 0.61);
    }

    #[test]
    fn the_club_sums_the_sub_but_keeps_the_top_wide() {
        let mut club = curve(Device::Club);
        club.room_on = false;
        let side = |hz: f32, club: &mut DeviceCurve| {
            let mut samples: Vec<f32> = (0..RATE as usize)
                .flat_map(|i| {
                    let v = (std::f32::consts::TAU * hz * i as f32 / RATE).sin();
                    [v, -v]
                })
                .collect();
            for chunk in samples.chunks_mut(256) {
                club.process(chunk);
            }
            let tail = &samples[samples.len() / 2..];
            tail.chunks(2)
                .fold(0f32, |m, f| m.max((f[0] - f[1]).abs() / 2.0))
        };
        assert!(side(50.0, &mut club) < 0.2);
        assert!(side(3000.0, &mut club) > 0.9);
    }

    #[test]
    fn the_radio_compresses_loud_input() {
        let mut radio = curve(Device::Radio);
        let gain = measured_gain_db(|s| radio.process(s), 1000.0);
        // A −9 dBFS RMS sine peaks at −6 dBFS, 14 dB over −20 at ratio 4.
        assert!(gain < -6.0, "{gain}");
    }

    #[test]
    fn every_device_has_at_most_eight_bands() {
        for index in 0..Device::CHOICES.names.len() {
            assert!(Device::from_value(index as f32).profile().bands.len() <= BANDS);
        }
    }
}
