//! The offline analysers (flag bits 4 to 12 of an `Analysis` session): they
//! read the same stream as the streaming analysers and compute their results
//! when the session finishes, because each needs the whole file. The ones
//! that read spectra share one front end (`onsets`), so a file is transformed
//! once. `diff` compares two versions from their stored feature buffers
//! without a session.

mod curves;
pub mod diff;
mod fingerprint;
mod key;
mod onsets;
mod pitch_track;
mod sections;
mod spectrogram;
mod tempo;

use curves::Measures;
pub use curves::Timeline;
use diff::Series;
use fingerprint::Quantised;
use onsets::FrontEnd;
use pitch_track::PitchTrack;

use crate::analysis::loudness::Loudness;

/// The onset envelope, per-second log-mel means and per-second chroma, each
/// quantised to `u8` over its own range: what a later comparison reads.
pub const FLAG_FEATURES: u32 = 1 << 4;
pub const FLAG_TEMPO: u32 = 1 << 5;
pub const FLAG_KEY: u32 = 1 << 6;
pub const FLAG_SECTIONS: u32 = 1 << 7;
pub const FLAG_SPECTROGRAM: u32 = 1 << 8;
/// Short-term loudness and L/R correlation per second.
pub const FLAG_CURVES: u32 = 1 << 9;
pub const FLAG_CLIPPING: u32 = 1 << 10;
pub const FLAG_SILENCE: u32 = 1 << 11;
pub const FLAG_PITCH: u32 = 1 << 12;

const FRONT_END: u32 = FLAG_FEATURES | FLAG_TEMPO | FLAG_KEY | FLAG_SECTIONS | FLAG_SPECTROGRAM;
const TIMELINE: u32 = FLAG_CURVES | FLAG_CLIPPING | FLAG_SILENCE;
pub const FLAGS: u32 = FRONT_END | TIMELINE | FLAG_PITCH;
/// The offline flags that read the session's loudness meter.
pub const LOUDNESS_FLAGS: u32 = FLAG_CURVES | FLAG_CLIPPING;

/// A dot product over the shorter of `a` and `b`. The crate builds for size,
/// which turns off LLVM's vectorisers, so on wasm the lanes are `simd128`
/// vectors written out; elsewhere they are eight scalar sums.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    let (a8, a_tail) = a[..len].as_chunks::<8>();
    let (b8, b_tail) = b[..len].as_chunks::<8>();
    let tail: f32 = a_tail.iter().zip(b_tail).map(|(x, y)| x * y).sum();
    lanes(a8, b8) + tail
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
fn lanes(a: &[[f32; 8]], b: &[[f32; 8]]) -> f32 {
    use core::arch::wasm32::{f32x4, f32x4_add, f32x4_extract_lane, f32x4_mul, f32x4_splat};
    let vector = |x: &[f32; 8], at: usize| f32x4(x[at], x[at + 1], x[at + 2], x[at + 3]);
    let sum = a.iter().zip(b).fold(f32x4_splat(0.0), |sum, (x, y)| {
        let low = f32x4_mul(vector(x, 0), vector(y, 0));
        let high = f32x4_mul(vector(x, 4), vector(y, 4));
        f32x4_add(sum, f32x4_add(low, high))
    });
    f32x4_extract_lane::<0>(sum)
        + f32x4_extract_lane::<1>(sum)
        + f32x4_extract_lane::<2>(sum)
        + f32x4_extract_lane::<3>(sum)
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn lanes(a: &[[f32; 8]], b: &[[f32; 8]]) -> f32 {
    let mut sum = [0.0f32; 8];
    for (x, y) in a.iter().zip(b) {
        for lane in 0..8 {
            sum[lane] += x[lane] * y[lane];
        }
    }
    sum.iter().sum()
}

pub struct Offline {
    flags: u32,
    channels: usize,
    mono: Vec<f32>,
    front_end: Option<FrontEnd>,
    timeline: Option<Timeline>,
    pitch: Option<PitchTrack>,
    finished: bool,
    tempo: Option<[f32; 3]>,
    key: Option<[f32; 3]>,
    sections: Vec<f32>,
    features: Vec<Quantised>,
    empty: Quantised,
}

impl Offline {
    /// The analysers `flags` names (bits outside [`FLAGS`] are ignored here;
    /// the session refuses them).
    pub fn new(rate: u32, channels: u32, flags: u32) -> Self {
        let has = |bits: u32| flags & bits != 0;
        Self {
            flags,
            channels: channels as usize,
            mono: Vec::new(),
            front_end: has(FRONT_END).then(|| FrontEnd::new(rate, has(FLAG_SPECTROGRAM))),
            timeline: has(TIMELINE).then(|| {
                Timeline::new(
                    rate,
                    channels,
                    Measures {
                        curves: has(FLAG_CURVES),
                        clipping: has(FLAG_CLIPPING),
                        silence: has(FLAG_SILENCE),
                    },
                )
            }),
            pitch: has(FLAG_PITCH).then(|| PitchTrack::new(rate)),
            finished: false,
            tempo: None,
            key: None,
            sections: Vec::new(),
            features: Vec::new(),
            empty: Quantised::new(&[]),
        }
    }

    /// Whether `push` feeds the session's loudness meter itself.
    pub fn feeds_loudness(&self) -> bool {
        self.timeline.as_ref().is_some_and(Timeline::needs_loudness)
    }

    /// Feeds one chunk of interleaved samples, and `loudness` with it when
    /// [`Self::feeds_loudness`].
    pub fn push(&mut self, interleaved: &[f32], loudness: Option<&mut Loudness>) {
        if let Some(timeline) = &mut self.timeline {
            timeline.push(interleaved, loudness);
        }
        if self.front_end.is_none() && self.pitch.is_none() {
            return;
        }
        let scale = 1.0 / self.channels as f32;
        self.mono.clear();
        self.mono.extend(
            interleaved
                .chunks_exact(self.channels)
                .map(|frame| frame.iter().sum::<f32>() * scale),
        );
        if let Some(front_end) = &mut self.front_end {
            front_end.push(&self.mono);
        }
        if let Some(pitch) = &mut self.pitch {
            pitch.push(&self.mono);
        }
    }

    /// Runs every estimator over the whole stream, `duration_ms` long. Only
    /// the first call does anything.
    pub fn finish(&mut self, duration_ms: f32, loudness: Option<&Loudness>) {
        if std::mem::replace(&mut self.finished, true) {
            return;
        }
        let has = |bits: u32| self.flags & bits != 0;
        let round = |value: f32, places: f32| (value * places).round() / places;
        if let Some(front_end) = &mut self.front_end {
            front_end.finish();
            if has(FLAG_TEMPO) {
                self.tempo = tempo::estimate(front_end.onset(), 1.0 / front_end.hop_rate())
                    .map(|t| [t.bpm, t.beat_offset_ms.round(), round(t.confidence, 100.0)]);
            }
            if has(FLAG_KEY) {
                self.key = key::estimate(front_end.chroma_total()).map(|k| {
                    [
                        f32::from(k.tonic),
                        f32::from(u8::from(k.minor)),
                        round(k.confidence, 100.0),
                    ]
                });
            }
            if has(FLAG_SECTIONS) {
                let sections =
                    sections::segment(front_end.mel_seconds(), front_end.chroma_seconds());
                let last = sections.len().saturating_sub(1);
                self.sections = sections
                    .iter()
                    .enumerate()
                    .flat_map(|(i, s)| {
                        let end = if i == last {
                            duration_ms.round()
                        } else {
                            s.end_s as f32 * 1000.0
                        };
                        [s.start_s as f32 * 1000.0, end, s.group as f32]
                    })
                    .collect();
            }
            if has(FLAG_FEATURES) {
                let flat = |rows: &[f32]| Quantised::new(rows);
                self.features = vec![
                    flat(front_end.onset()),
                    flat(front_end.mel_seconds().as_flattened()),
                    flat(front_end.chroma_seconds().as_flattened()),
                ];
            }
        }
        if let Some(timeline) = &mut self.timeline {
            timeline.finish(loudness);
        }
        if let Some(pitch) = &mut self.pitch {
            pitch.finish();
        }
    }

    /// `[bpm, beatOffsetMs, confidence]`, or `None` before `finish`, without
    /// the flag, or for a stream with no periodicity.
    pub fn tempo(&self) -> Option<&[f32; 3]> {
        self.tempo.as_ref()
    }

    /// `[tonic (C = 0), minor (0 or 1), confidence]`, or `None` as for tempo.
    pub fn key(&self) -> Option<&[f32; 3]> {
        self.key.as_ref()
    }

    /// `[startMs, endMs, group]` per section, groups numbered from 0 in order
    /// of first appearance.
    pub fn sections(&self) -> &[f32] {
        &self.sections
    }

    /// 160 log-spaced bytes per 50 ms column, lowest band first.
    pub fn spectrogram(&self) -> &[u8] {
        self.finished_front_end()
            .and_then(|front_end| front_end.spectrogram.as_ref())
            .map_or(&[], |spectrogram| spectrogram.bytes())
    }

    pub fn timeline(&self) -> Option<&Timeline> {
        self.timeline.as_ref().filter(|_| self.finished)
    }

    pub fn pitch_track(&self) -> &[f32] {
        self.pitch
            .as_ref()
            .filter(|_| self.finished)
            .map_or(&[], PitchTrack::values)
    }

    /// The quantised bytes and range of one feature series; empty before
    /// `finish` or without the features flag.
    pub fn feature(&self, series: Series) -> &Quantised {
        let index = match series {
            Series::Onset => 0,
            Series::Mel => 1,
            Series::Chroma => 2,
        };
        self.features.get(index).unwrap_or(&self.empty)
    }

    fn finished_front_end(&self) -> Option<&FrontEnd> {
        self.front_end.as_ref().filter(|_| self.finished)
    }
}

#[cfg(test)]
pub(crate) mod test_signals {
    //! Synthetic signals the offline analysers' tests share, mono at 48 kHz.

    use std::f32::consts::TAU;

    pub const RATE: u32 = 48_000;

    fn samples(seconds: f32) -> usize {
        (RATE as f32 * seconds).round() as usize
    }

    pub fn sine(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
        (0..samples(seconds))
            .map(|i| amplitude * (TAU * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    /// A note with two overtones and 5 ms fades, so it starts and stops
    /// without a click.
    pub fn tone(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
        let len = samples(seconds);
        let fade = samples(0.005) as f32;
        (0..len)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                let envelope = (i as f32 / fade).min((len - i) as f32 / fade).min(1.0);
                let partials = (TAU * hz * t).sin()
                    + 0.5 * (TAU * 2.0 * hz * t).sin()
                    + 0.25 * (TAU * 3.0 * hz * t).sin();
                amplitude * envelope * partials / 1.75
            })
            .collect()
    }

    pub fn midi_hz(note: i32) -> f32 {
        440.0 * 2f32.powf((note - 69) as f32 / 12.0)
    }

    /// One full-scale sample every beat at `bpm`, the first at `first_s`.
    pub fn click_train(bpm: f32, first_s: f32, seconds: f32) -> Vec<f32> {
        let mut signal = vec![0.0; samples(seconds)];
        let mut beat = 0;
        while let Some(sample) = signal.get_mut(samples(first_s + beat as f32 * 60.0 / bpm)) {
            *sample = 1.0;
            beat += 1;
        }
        signal
    }

    /// Uniform white noise from `seed`.
    pub fn noise(seconds: f32, amplitude: f32, seed: u32) -> Vec<f32> {
        let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
        (0..samples(seconds))
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                amplitude * ((state >> 8) as f32 / (1u32 << 23) as f32 - 1.0)
            })
            .collect()
    }
}
