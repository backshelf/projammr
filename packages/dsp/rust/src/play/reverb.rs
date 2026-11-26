//! An audition reverb with a pre-delay: "Freeverb" by Jezar at Dreampoint
//! (public domain, 2000; <https://ccrma.stanford.edu/~jos/pasp/Freeverb.html>).
//! Eight lowpass-feedback comb filters per channel in parallel, then four
//! all-passes in series, with the original tunings scaled to the rate and the
//! right channel spread by 23 samples.

use super::params::{ParamId, choices};
use super::{Block, CHANNELS};

const COMB_TUNING: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING: [usize; 4] = [556, 441, 341, 225];
const STEREO_SPREAD: usize = 23;
const TUNING_RATE: f32 = 44_100.0;

const FIXED_GAIN: f32 = 0.015;
const SCALE_WET: f32 = 3.0;
const SCALE_DAMP: f32 = 0.4;
const SCALE_ROOM: f32 = 0.28;
const OFFSET_ROOM: f32 = 0.7;
const ALLPASS_FEEDBACK: f32 = 0.5;
const MAX_PRE_DELAY_MS: f32 = 100.0;

choices! {
    /// A room, as a size, a damping, a pre-delay and a wet ceiling.
    pub enum Preset {
        Booth,
        Room,
        Hall,
        Club,
    }
}

struct Room {
    size: f32,
    damping: f32,
    pre_delay_ms: f32,
    max_wet: f32,
}

impl Preset {
    fn room(self) -> Room {
        let (size, damping, pre_delay_ms, max_wet) = match self {
            Preset::Booth => (0.3, 0.6, 5.0, 1.0),
            Preset::Room => (0.55, 0.5, 15.0, 1.0),
            Preset::Hall => (0.85, 0.3, 40.0, 1.0),
            Preset::Club => (0.7, 0.7, 25.0, 0.35),
        };
        Room {
            size,
            damping,
            pre_delay_ms,
            max_wet,
        }
    }

    /// The loop gain of every comb at this preset's size.
    pub fn feedback(self) -> f32 {
        self.room().size * SCALE_ROOM + OFFSET_ROOM
    }
}

struct Comb {
    buffer: Vec<f32>,
    index: usize,
    filter_store: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len],
            index: 0,
            filter_store: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let output = self.buffer[self.index];
        self.filter_store = output * (1.0 - damp) + self.filter_store * damp;
        if self.filter_store.abs() < 1e-20 {
            self.filter_store = 0.0;
        }
        self.buffer[self.index] = input + self.filter_store * feedback;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.filter_store = 0.0;
    }
}

struct AllPass {
    buffer: Vec<f32>,
    index: usize,
}

impl AllPass {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len],
            index: 0,
        }
    }

    #[inline]
    fn tick(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.index];
        self.buffer[self.index] = input + delayed * ALLPASS_FEEDBACK;
        self.index = (self.index + 1) % self.buffer.len();
        delayed - input
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
    }
}

pub struct Reverb {
    rate: f32,
    preset: Preset,
    wet: f32,
    pre_delay: usize,
    delay_line: Vec<f32>,
    delay_index: usize,
    combs: [Vec<Comb>; CHANNELS],
    allpasses: [Vec<AllPass>; CHANNELS],
}

impl Reverb {
    pub fn new(rate: f32, preset: Preset, wet: f32) -> Self {
        let scale = |samples: usize, channel: usize| {
            (((samples + channel * STEREO_SPREAD) as f32 * rate / TUNING_RATE).round() as usize)
                .max(1)
        };
        let max_delay = (MAX_PRE_DELAY_MS * 1e-3 * rate).ceil() as usize + 1;
        let mut reverb = Self {
            rate,
            preset,
            wet,
            pre_delay: 0,
            delay_line: vec![0.0; max_delay * CHANNELS],
            delay_index: 0,
            combs: std::array::from_fn(|c| {
                COMB_TUNING
                    .iter()
                    .map(|&t| Comb::new(scale(t, c)))
                    .collect()
            }),
            allpasses: std::array::from_fn(|c| {
                ALLPASS_TUNING
                    .iter()
                    .map(|&t| AllPass::new(scale(t, c)))
                    .collect()
            }),
        };
        reverb.set_preset(preset);
        reverb
    }

    /// A reverb at the parameter table's defaults.
    pub fn with_defaults(rate: f32) -> Self {
        let default = |param: ParamId| param.spec().domain.default_value();
        let mut reverb = Self::new(
            rate,
            Preset::from_value(default(ParamId::ReverbPreset)),
            default(ParamId::ReverbWet),
        );
        reverb.set_pre_delay_ms(default(ParamId::ReverbPreDelayMs));
        reverb
    }

    /// Selects a room, which also sets the pre-delay to the room's own; a
    /// pre-delay set afterwards overrides it.
    pub fn set_preset(&mut self, preset: Preset) {
        self.preset = preset;
        self.set_pre_delay_ms(preset.room().pre_delay_ms);
    }

    pub fn set_pre_delay_ms(&mut self, ms: f32) {
        let frames = self.delay_line.len() / CHANNELS;
        self.pre_delay =
            ((ms.clamp(0.0, MAX_PRE_DELAY_MS) * 1e-3 * self.rate).round() as usize).min(frames - 1);
    }
}

impl Block for Reverb {
    fn set(&mut self, param: ParamId, value: f32) {
        match param {
            ParamId::ReverbPreset => self.set_preset(Preset::from_value(value)),
            ParamId::ReverbWet => self.wet = value,
            _ => self.set_pre_delay_ms(value),
        }
    }

    fn process(&mut self, samples: &mut [f32]) {
        let room = self.preset.room();
        let feedback = self.preset.feedback();
        let damp = room.damping * SCALE_DAMP;
        let wet = self.wet.min(room.max_wet);
        let wet_gain = wet * SCALE_WET;
        let dry_gain = 1.0 - wet;
        let frames = self.delay_line.len() / CHANNELS;

        for frame in samples.chunks_exact_mut(CHANNELS) {
            let write = self.delay_index * CHANNELS;
            self.delay_line[write..write + CHANNELS].copy_from_slice(frame);
            let read = (self.delay_index + frames - self.pre_delay) % frames * CHANNELS;
            let input = (self.delay_line[read] + self.delay_line[read + 1]) * FIXED_GAIN;
            self.delay_index = (self.delay_index + 1) % frames;

            for (c, sample) in frame.iter_mut().enumerate() {
                let mut out = 0.0;
                for comb in &mut self.combs[c] {
                    out += comb.tick(input, feedback, damp);
                }
                for allpass in &mut self.allpasses[c] {
                    out = allpass.tick(out);
                }
                *sample = *sample * dry_gain + out * wet_gain;
            }
        }
    }

    fn reset(&mut self) {
        self.delay_line.fill(0.0);
        for comb in self.combs.iter_mut().flatten() {
            comb.clear();
        }
        for allpass in self.allpasses.iter_mut().flatten() {
            allpass.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// Seconds from the impulse until the 10 ms energy of the wet tail falls
    /// 60 dB below its loudest window.
    fn tail_seconds(preset: Preset) -> f32 {
        let mut reverb = Reverb::new(RATE, preset, 1.0);
        reverb.set_pre_delay_ms(0.0);
        let mut samples = vec![0.0f32; 8 * RATE as usize * CHANNELS];
        samples[0] = 1.0;
        samples[1] = 1.0;
        for chunk in samples.chunks_mut(128 * CHANNELS) {
            reverb.process(chunk);
        }
        let window = (0.01 * RATE) as usize * CHANNELS;
        let energy: Vec<f32> = samples
            .chunks(window)
            .map(|w| w.iter().map(|v| v * v).sum())
            .collect();
        let loudest = energy.iter().cloned().fold(0.0, f32::max);
        let last = energy.iter().rposition(|&e| e > loudest * 1e-6).unwrap();
        (last + 1) as f32 * 0.01
    }

    /// The Sabine-style estimate: 60 dB over the combs' mean loop length.
    fn predicted_seconds(preset: Preset) -> f32 {
        let loop_seconds = COMB_TUNING.iter().sum::<usize>() as f32 / 8.0 / TUNING_RATE;
        let db_per_loop = -20.0 * preset.feedback().log10();
        60.0 / db_per_loop * loop_seconds
    }

    #[test]
    fn each_preset_rings_about_as_long_as_its_loop_gain_predicts() {
        for preset in [Preset::Booth, Preset::Room, Preset::Club, Preset::Hall] {
            let (measured, predicted) = (tail_seconds(preset), predicted_seconds(preset));
            assert!(
                (measured / predicted - 1.0).abs() < 0.3,
                "{preset:?}: {measured} s against {predicted} s"
            );
        }
    }

    #[test]
    fn larger_rooms_ring_longer() {
        let tails = [Preset::Booth, Preset::Room, Preset::Club, Preset::Hall].map(tail_seconds);
        assert!(tails.windows(2).all(|pair| pair[0] < pair[1]), "{tails:?}");
    }

    #[test]
    fn the_pre_delay_holds_the_tail_back() {
        let mut reverb = Reverb::new(RATE, Preset::Room, 1.0);
        reverb.set(ParamId::ReverbPreDelayMs, 50.0);
        let mut samples = vec![0.0f32; RATE as usize / 10 * CHANNELS];
        samples[0] = 1.0;
        reverb.process(&mut samples);
        let first = samples.iter().position(|v| v.abs() > 1e-9).unwrap() / CHANNELS;
        let expected = (0.05 * RATE) as usize + (556.0 * RATE / TUNING_RATE).round() as usize;
        assert!(first >= expected - 2, "{first} < {expected}");
    }

    #[test]
    fn the_club_preset_caps_its_wet_level() {
        let loudness = |preset: Preset| {
            let mut reverb = Reverb::new(RATE, preset, 1.0);
            reverb.set_pre_delay_ms(0.0);
            let mut samples = vec![0.0f32; RATE as usize * CHANNELS];
            samples[0] = 1.0;
            reverb.process(&mut samples);
            // The dry impulse sits at frame 0; with wet capped, it survives.
            samples[0]
        };
        assert_eq!(loudness(Preset::Hall), 0.0);
        assert!((loudness(Preset::Club) - 0.65).abs() < 1e-6);
    }
}
