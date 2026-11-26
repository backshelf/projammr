//! Time-stretch: a phase vocoder with identity phase locking and transient
//! reset.
//!
//! Identity phase locking after J. Laroche and M. Dolson, "Improved phase
//! vocoder time-scale modification of audio", IEEE Trans. Speech and Audio
//! Processing 7(3), 1999: peak bins get a true-frequency phase advance and
//! every other bin keeps its phase offset from the nearest peak. Transients
//! after A. Röbel, "A new approach to transient processing in the phase
//! vocoder", DAFx 2003: when the spectral flux jumps above 1.5 × its running
//! median, the output takes the input's phases, which re-anchors the attack.
//!
//! Frames are [`FRAME`] samples with √Hann analysis and synthesis windows at a
//! synthesis hop of [`HOP`]; the analysis hop is `HOP / ratio`. Both channels
//! share one peak map, taken from their summed magnitudes, which keeps the
//! stereo image stable.
//!
//! At a ratio of exactly 1 the input passes through sample for sample, delayed
//! by [`LATENCY`] like the vocoder, so moving between the two is seamless: an
//! overlap-add weight tracks how much of each output sample the vocoder has
//! already written, and the input fills in the rest.

use super::CHANNELS;
use crate::util::fft::{Complex, FftPair};
use crate::util::window;

pub const FRAME: usize = 2048;
pub const HOP: usize = 512;
/// Output frames between an input frame entering and leaving the stretcher.
pub const LATENCY: usize = FRAME - HOP;
pub const MIN_RATIO: f64 = 0.5;
pub const MAX_RATIO: f64 = 4.0;

const BINS: usize = FRAME / 2 + 1;
const FLUX_HISTORY: usize = 16;
const FLUX_HISTORY_MIN: usize = 8;
const TRANSIENT_FACTOR: f32 = 1.5;
/// The least flux, as a share of the frame's magnitude, that counts as an
/// onset; below it the median test would fire on rounding noise.
const TRANSIENT_FLOOR: f32 = 0.1;
/// One frame plus the largest analysis hop, plus rounding.
const INPUT_CAPACITY: usize = FRAME + (HOP as f64 / MIN_RATIO) as usize + 2;

pub struct Stretcher {
    ratio: f64,
    fft: FftPair,
    analysis: Vec<f32>,
    /// The synthesis window, scaled for the inverse transform and the overlap.
    synthesis: Vec<f32>,
    /// What one frame adds to the overlap-add weight at each offset.
    frame_weight: Vec<f32>,
    /// The weight the three frames before a frame contribute at each offset.
    earlier_weight: Vec<f32>,

    fft_in: Vec<f32>,
    spectrum: Vec<Complex>,
    fft_out: Vec<f32>,
    scratch: Vec<Complex>,

    /// Interleaved input from `read_pos`'s frame of reference.
    input: Vec<f32>,
    input_frames: usize,
    read_pos: f64,
    /// How far `read_pos` moved on the last hop.
    advance: f64,
    /// Whether the last hop ran the vocoder, so its phases carry on.
    vocoding: bool,

    magnitudes: [Vec<f32>; CHANNELS],
    phases: [Vec<f32>; CHANNELS],
    previous_phases: [Vec<f32>; CHANNELS],
    output_phases: [Vec<f32>; CHANNELS],
    magnitude_sum: Vec<f32>,
    previous_magnitude_sum: Vec<f32>,
    peaks: Vec<usize>,
    flux: [f32; FLUX_HISTORY],
    flux_count: usize,
    flux_next: usize,

    overlap: [Vec<f32>; CHANNELS],
    weight: Vec<f32>,
}

impl Default for Stretcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Stretcher {
    pub fn new() -> Self {
        let fft = FftPair::new(FRAME);
        let hann = window::hann(FRAME);
        // √Hann twice is Hann, which overlap-adds to FRAME / (2 · HOP) at this hop.
        let overlap_gain = HOP as f32 / (FRAME as f32 / 2.0);
        let frame_weight: Vec<f32> = hann.iter().map(|w| w * overlap_gain).collect();
        let earlier_weight = (0..FRAME)
            .map(|i| {
                (1..FRAME / HOP)
                    .filter_map(|j| frame_weight.get(i + j * HOP))
                    .sum()
            })
            .collect();
        let scratch_len = fft
            .forward
            .get_scratch_len()
            .max(fft.inverse.get_scratch_len());
        let bins = || vec![0.0; BINS];
        let mut stretcher = Self {
            ratio: 1.0,
            analysis: window::sqrt_hann(FRAME),
            synthesis: window::sqrt_hann(FRAME)
                .iter()
                .map(|w| w * overlap_gain / FRAME as f32)
                .collect(),
            frame_weight,
            earlier_weight,
            fft_in: vec![0.0; FRAME],
            spectrum: vec![Complex::default(); BINS],
            fft_out: vec![0.0; FRAME],
            scratch: vec![Complex::default(); scratch_len],
            fft,
            input: vec![0.0; INPUT_CAPACITY * CHANNELS],
            input_frames: 0,
            read_pos: 0.0,
            advance: HOP as f64,
            vocoding: false,
            magnitudes: [bins(), bins()],
            phases: [bins(), bins()],
            previous_phases: [bins(), bins()],
            output_phases: [bins(), bins()],
            magnitude_sum: bins(),
            previous_magnitude_sum: bins(),
            peaks: Vec::with_capacity(BINS),
            flux: [0.0; FLUX_HISTORY],
            flux_count: 0,
            flux_next: 0,
            overlap: [vec![0.0; FRAME], vec![0.0; FRAME]],
            weight: vec![0.0; FRAME],
        };
        stretcher.reset();
        stretcher
    }

    /// Output seconds per input second, clamped to [`MIN_RATIO`]..[`MAX_RATIO`].
    /// Takes effect at the next hop.
    pub fn set_ratio(&mut self, ratio: f64) {
        self.ratio = ratio.clamp(MIN_RATIO, MAX_RATIO);
    }

    /// Output frames between an input frame being read and being written, at
    /// the current ratio: frame centres line up, so the lead of a frame's
    /// start over its centre stretches with the ratio. [`LATENCY`] at 1.
    pub fn latency(&self) -> f64 {
        let centre = (FRAME / 2) as f64;
        centre + (LATENCY as f64 - centre) * self.ratio
    }

    /// Flushes all input and output; the next hop starts [`LATENCY`] frames
    /// of silence ahead of the next input.
    pub fn reset(&mut self) {
        self.input.fill(0.0);
        self.input_frames = LATENCY;
        self.read_pos = 0.0;
        self.vocoding = false;
        self.flux_count = 0;
        for buffer in self.overlap.iter_mut() {
            buffer.fill(0.0);
        }
        self.weight.fill(0.0);
    }

    /// Writes the next [`HOP`] frames of interleaved output to `out`, reading
    /// interleaved input from `source` at frame `*consumed` and advancing it.
    /// Input past the end of `source` reads as silence.
    pub fn step(&mut self, source: &[f32], consumed: &mut usize, out: &mut [f32]) {
        let vocode = self.ratio != 1.0;
        if self.vocoding && !vocode {
            // The vocoder's last output hop was HOP frames of the input, so
            // the input picks up HOP frames on from that frame, not one
            // analysis hop on.
            self.read_pos += HOP as f64 - self.advance;
        }
        let start = self.read_pos.round() as usize;
        self.fill(start + FRAME, source, consumed);

        if vocode {
            let entering = !self.vocoding;
            if entering {
                self.complete_earlier_frames(start);
            }
            self.analyse(start);
            if entering {
                self.flux_count = 0;
                self.previous_magnitude_sum
                    .copy_from_slice(&self.magnitude_sum);
            }
            let transient = self.detect_transient();
            // The input before the last frame's start has been released, so
            // this frame starts `start` frames after it.
            let hop = start as f32;
            self.lock_phases(entering || transient || hop == 0.0, hop);
            self.synthesise();
        }

        // Whatever weight the vocoder has not written comes from the input.
        for (i, frame) in out.chunks_exact_mut(CHANNELS).take(HOP).enumerate() {
            let rest = 1.0 - self.weight[i];
            for (c, sample) in frame.iter_mut().enumerate() {
                *sample = self.overlap[c][i] + self.input[(start + i) * CHANNELS + c] * rest;
            }
        }
        for buffer in self
            .overlap
            .iter_mut()
            .chain(std::iter::once(&mut self.weight))
        {
            buffer.copy_within(HOP.., 0);
            buffer[FRAME - HOP..].fill(0.0);
        }

        self.vocoding = vocode;
        self.advance = HOP as f64 / self.ratio;
        self.read_pos += self.advance;
        // Every later frame starts at or after this one.
        self.input
            .copy_within(start * CHANNELS..self.input_frames * CHANNELS, 0);
        self.input_frames -= start;
        self.read_pos -= start as f64;
    }

    fn fill(&mut self, frames: usize, source: &[f32], consumed: &mut usize) {
        let wanted = frames.saturating_sub(self.input_frames);
        let available = (source.len() / CHANNELS)
            .saturating_sub(*consumed)
            .min(wanted);
        let at = self.input_frames * CHANNELS;
        self.input[at..at + available * CHANNELS]
            .copy_from_slice(&source[*consumed * CHANNELS..(*consumed + available) * CHANNELS]);
        self.input[at + available * CHANNELS..at + wanted * CHANNELS].fill(0.0);
        *consumed += available;
        self.input_frames += wanted;
    }

    /// Before the first vocoder frame after a run of pass-through, writes the
    /// input's share of the three frames that would have preceded it.
    fn complete_earlier_frames(&mut self, start: usize) {
        for i in 0..FRAME {
            let missing = self.earlier_weight[i] - self.weight[i];
            if missing > 0.0 {
                for c in 0..CHANNELS {
                    self.overlap[c][i] += self.input[(start + i) * CHANNELS + c] * missing;
                }
                self.weight[i] = self.earlier_weight[i];
            }
        }
    }

    fn analyse(&mut self, start: usize) {
        self.magnitude_sum.fill(0.0);
        for c in 0..CHANNELS {
            for (i, v) in self.fft_in.iter_mut().enumerate() {
                *v = self.input[(start + i) * CHANNELS + c] * self.analysis[i];
            }
            // Only fails on mismatched lengths, which the buffers rule out.
            let _ = self.fft.forward.process_with_scratch(
                &mut self.fft_in,
                &mut self.spectrum,
                &mut self.scratch,
            );
            for (k, bin) in self.spectrum.iter().enumerate() {
                let (magnitude, phase) = bin.to_polar();
                self.magnitudes[c][k] = magnitude;
                self.phases[c][k] = phase;
                self.magnitude_sum[k] += magnitude;
            }
        }
    }

    /// Half-wave rectified spectral flux, as a share of the frame's
    /// magnitude, against a running median.
    fn detect_transient(&mut self) -> bool {
        let rise: f32 = self
            .magnitude_sum
            .iter()
            .zip(&self.previous_magnitude_sum)
            .map(|(now, before)| (now - before).max(0.0))
            .sum();
        let flux = rise / (self.magnitude_sum.iter().sum::<f32>() + 1e-9);
        self.previous_magnitude_sum
            .copy_from_slice(&self.magnitude_sum);

        let mut history = [0.0; FLUX_HISTORY];
        let history = &mut history[..self.flux_count];
        history.copy_from_slice(&self.flux[..self.flux_count]);
        history.sort_unstable_by(f32::total_cmp);
        let transient = self.flux_count >= FLUX_HISTORY_MIN
            && flux > TRANSIENT_FLOOR
            && flux > TRANSIENT_FACTOR * history[self.flux_count / 2];

        self.flux[self.flux_next] = flux;
        self.flux_next = (self.flux_next + 1) % FLUX_HISTORY;
        self.flux_count = (self.flux_count + 1).min(FLUX_HISTORY);
        transient
    }

    /// Sets the output phases for this frame from the analysis phases and the
    /// analysis hop actually taken since the last frame.
    fn lock_phases(&mut self, reset: bool, hop: f32) {
        self.peaks.clear();
        let m = &self.magnitude_sum;
        for k in 2..BINS - 2 {
            if m[k] > m[k - 1] && m[k] > m[k - 2] && m[k] > m[k + 1] && m[k] > m[k + 2] {
                self.peaks.push(k);
            }
        }

        let bin_hz = std::f32::consts::TAU / FRAME as f32;
        for c in 0..CHANNELS {
            let (phases, output) = (&self.phases[c], &mut self.output_phases[c]);
            if reset || self.peaks.is_empty() {
                output.copy_from_slice(phases);
            } else {
                for &k in &self.peaks {
                    let omega = bin_hz * k as f32;
                    let deviation = principal(phases[k] - self.previous_phases[c][k] - omega * hop);
                    let frequency = omega + deviation / hop;
                    output[k] = principal(output[k] + frequency * HOP as f32);
                }
                let mut p = 0;
                for k in 0..BINS {
                    while p + 1 < self.peaks.len() && 2 * k > self.peaks[p] + self.peaks[p + 1] {
                        p += 1;
                    }
                    let peak = self.peaks[p];
                    if peak != k {
                        output[k] = principal(output[peak] + phases[k] - phases[peak]);
                    }
                }
            }
            self.previous_phases[c].copy_from_slice(phases);
        }
    }

    fn synthesise(&mut self) {
        for c in 0..CHANNELS {
            for (k, bin) in self.spectrum.iter_mut().enumerate() {
                *bin = Complex::from_polar(self.magnitudes[c][k], self.output_phases[c][k]);
            }
            // The Nyquist bin of an even-length frame is real.
            self.spectrum[BINS - 1].im = 0.0;
            let _ = self.fft.inverse.process_with_scratch(
                &mut self.spectrum,
                &mut self.fft_out,
                &mut self.scratch,
            );
            for (i, sample) in self.fft_out.iter().enumerate() {
                self.overlap[c][i] += sample * self.synthesis[i];
            }
        }
        for (weight, add) in self.weight.iter_mut().zip(&self.frame_weight) {
            *weight += add;
        }
    }
}

fn principal(phase: f32) -> f32 {
    use std::f32::consts::{PI, TAU};
    phase - TAU * ((phase + PI) / TAU).floor()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const RATE: usize = 48_000;

    pub fn sine(hz: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .flat_map(|i| {
                let v = 0.5 * (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin();
                [v, v]
            })
            .collect()
    }

    /// Stretches all of `source` and the silence after it, until the
    /// stretcher has emitted everything the source became.
    fn stretch(source: &[f32], ratio: f64) -> Vec<f32> {
        let mut stretcher = Stretcher::new();
        stretcher.set_ratio(ratio);
        let frames = source.len() / CHANNELS;
        let total = LATENCY + (frames as f64 * ratio) as usize + 2 * FRAME;
        let mut out = vec![0.0; total.div_ceil(HOP) * HOP * CHANNELS];
        let mut consumed = 0;
        for hop in out.chunks_mut(HOP * CHANNELS) {
            stretcher.step(source, &mut consumed, hop);
        }
        out.drain(..LATENCY * CHANNELS);
        out
    }

    fn left(samples: &[f32]) -> Vec<f32> {
        samples.iter().step_by(CHANNELS).copied().collect()
    }

    /// `seconds` of a 1 kHz sine after half a second of silence, so no part
    /// of the stretched sine falls before the output starts.
    fn delayed_sine(hz: f32, seconds: f32) -> Vec<f32> {
        let mut source = vec![0.0; RATE / 2 * CHANNELS];
        source.extend(sine(hz, (seconds * RATE as f32) as usize));
        source
    }

    /// Frames from the first to the last sample whose magnitude passes `level`.
    fn sounding_frames(samples: &[f32], level: f32) -> usize {
        let l = left(samples);
        let first = l.iter().position(|v| v.abs() > level).unwrap();
        let last = l.iter().rposition(|v| v.abs() > level).unwrap();
        last - first
    }

    pub fn loudest_hz(samples: &[f32], from: usize) -> f32 {
        let len = 8192;
        let plan = crate::util::fft::forward(len);
        let hann = window::hann(len);
        let mut input: Vec<f32> = left(samples)[from..from + len]
            .iter()
            .zip(&hann)
            .map(|(v, w)| v * w)
            .collect();
        let mut spectrum = plan.make_output_vec();
        plan.process(&mut input, &mut spectrum).unwrap();
        let bin = (0..spectrum.len())
            .max_by(|&a, &b| spectrum[a].norm().total_cmp(&spectrum[b].norm()))
            .unwrap();
        bin as f32 * RATE as f32 / len as f32
    }

    #[test]
    fn a_ratio_of_1_passes_the_input_through_bit_exact_after_the_latency() {
        let source: Vec<f32> = (0..20_000)
            .map(|i| ((i * 7919) % 1013) as f32 / 1013.0 - 0.5)
            .collect();
        let out = stretch(&source, 1.0);
        assert_eq!(&out[..source.len()], &source[..]);
    }

    #[test]
    fn a_1_khz_sine_stretched_by_2_keeps_its_frequency_and_doubles_its_length() {
        let source = delayed_sine(1000.0, 1.0);
        let out = stretch(&source, 2.0);
        let bin_hz = RATE as f32 / 8192.0;
        assert!((loudest_hz(&out, RATE * 3 / 2) - 1000.0).abs() <= bin_hz);
        let length = sounding_frames(&out, 0.25);
        assert!(length.abs_diff(2 * RATE) <= HOP, "{length}");
    }

    #[test]
    fn a_ratio_of_half_halves_the_length() {
        let source = delayed_sine(440.0, 1.0);
        let out = stretch(&source, 0.5);
        let length = sounding_frames(&out, 0.25);
        assert!(length.abs_diff(RATE / 2) <= HOP, "{length}");
        assert!((loudest_hz(&out, RATE / 4 + 2000) - 440.0).abs() <= RATE as f32 / 8192.0);
    }

    const CLICK_SPACING: usize = RATE / 4;

    /// The left channel of a 4 Hz train of 1 ms clicks stretched by 1.5, and
    /// each click's onset in it: the first sample above half the loudest
    /// level after a stretch of quiet.
    fn stretched_click_train() -> (Vec<f32>, Vec<usize>) {
        let mut source = vec![0.0f32; 3 * RATE * CHANNELS];
        for click in (CLICK_SPACING / 2..3 * RATE).step_by(CLICK_SPACING) {
            for i in 0..48 {
                let v = (1.0 - i as f32 / 48.0) * if i % 2 == 0 { 1.0 } else { -1.0 };
                source[(click + i) * CHANNELS] = v;
                source[(click + i) * CHANNELS + 1] = v;
            }
        }
        let out = left(&stretch(&source, 1.5));
        let loudest = out.iter().fold(0f32, |m, v| m.max(v.abs()));
        let mut onsets = Vec::new();
        let mut quiet_until = 0;
        for (i, v) in out.iter().enumerate() {
            if i >= quiet_until && v.abs() > loudest * 0.5 {
                onsets.push(i);
                quiet_until = i + CLICK_SPACING;
            }
        }
        (out, onsets)
    }

    #[test]
    fn a_4_hz_click_train_stretched_by_1_5_keeps_its_clicks_375_ms_apart() {
        let (_, onsets) = stretched_click_train();
        assert!(onsets.len() >= 10, "{onsets:?}");
        for pair in onsets.windows(2) {
            let gap_ms = (pair[1] - pair[0]) as f32 * 1000.0 / RATE as f32;
            assert!((gap_ms - 375.0).abs() <= 10.0, "{onsets:?}");
        }
    }

    #[test]
    fn the_transient_reset_keeps_a_stretched_click_from_smearing_ahead_of_its_onset() {
        let (out, onsets) = stretched_click_train();
        assert!(onsets.len() >= 10, "{onsets:?}");
        // Energy in the 10 ms before each onset, as a share of the energy
        // within half a click spacing either side. Re-anchoring the phases at
        // the attack keeps it near 3 %; without the reset it passes 12 %.
        let (mut ahead, mut click) = (0f32, 0f32);
        for &onset in &onsets {
            let energy = |from: usize, to: usize| -> f32 {
                out[from..to.min(out.len())].iter().map(|v| v * v).sum()
            };
            ahead += energy(onset.saturating_sub(RATE / 100), onset);
            click += energy(
                onset.saturating_sub(CLICK_SPACING / 2),
                onset + CLICK_SPACING / 2,
            );
        }
        let share = ahead / click;
        assert!(share < 0.06, "{share}");
    }

    #[test]
    fn moving_between_pass_through_and_stretching_keeps_the_level_within_1_5_db() {
        let source = sine(440.0, 3 * RATE);
        let mut stretcher = Stretcher::new();
        let mut consumed = 0;
        let mut out = vec![0.0; HOP * CHANNELS];
        let mut levels = Vec::new();
        for hop in 0..200 {
            stretcher.set_ratio(match hop % 40 {
                0..20 => 1.0,
                _ => 1.25,
            });
            stretcher.step(&source, &mut consumed, &mut out);
            if hop > 8 {
                levels.push(out.iter().fold(0f32, |m, v| m.max(v.abs())));
            }
        }
        // Leaving the vocoder, its drifted phases meet the input's for one
        // hop; the dip stays within 1.5 dB.
        for level in levels {
            let db = 20.0 * (level / 0.5).log10();
            assert!(db.abs() < 1.5, "{db} dB");
        }
    }

    #[test]
    fn reset_flushes_to_silence() {
        let source = sine(440.0, RATE);
        let mut stretcher = Stretcher::new();
        stretcher.set_ratio(1.5);
        let mut consumed = 0;
        let mut out = vec![0.0; HOP * CHANNELS];
        for _ in 0..20 {
            stretcher.step(&source, &mut consumed, &mut out);
        }
        stretcher.reset();
        stretcher.step(&[], &mut 0, &mut out);
        assert!(out.iter().all(|v| *v == 0.0));
    }
}
