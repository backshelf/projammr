//! The dominant pitch over time (E10) by YIN: A. de Cheveigné and
//! H. Kawahara, "YIN, a fundamental frequency estimator for speech and
//! music", JASA 111(4), 2002.
//!
//! The mono feed is low-passed and decimated to about 8 kHz first: the
//! difference function costs the frame length times the longest lag, and a
//! mix's dominant pitch (a bass or a lead) sits far below 4 kHz. Frames span
//! 2048 samples at 48 kHz (43 ms) with 10 ms hops, centred like the front
//! end's; five hops make one stored 50 ms value.

use super::dot;
use crate::play::biquad::Coefs;

/// The decimated rate aimed for; the factor is the whole ratio below it.
const TARGET_RATE: u32 = 8_000;
/// The first cumulative-mean-normalised dip below this is the period.
const THRESHOLD: f32 = 0.15;
/// A frame quieter than −50 dBFS RMS is unvoiced.
const VOICED_RMS: f32 = 0.003_162_3;
const HOPS_PER_VALUE: usize = 5;
/// The Butterworth pair's Qs, for a fourth-order low-pass.
const BUTTERWORTH_Q: [f32; 2] = [0.541_196_1, 1.306_563];

pub struct PitchTrack {
    factor: usize,
    rate: f32,
    lowpass: [(Coefs, [f64; 2]); 2],
    phase: usize,
    frame: usize,
    hop: usize,
    pending: Vec<f32>,
    difference: Vec<f32>,
    /// Decimated samples fed so far.
    fed: u64,
    hops: u64,
    group: Vec<f32>,
    values: Vec<f32>,
}

impl PitchTrack {
    pub fn new(rate: u32) -> Self {
        let factor = (rate / TARGET_RATE).max(1) as usize;
        let decimated = rate as f32 / factor as f32;
        let cutoff = 0.45 * decimated;
        let frame = (((2048.0 / 48_000.0) * decimated).round() as usize).max(4) & !1;
        Self {
            factor,
            rate: decimated,
            lowpass: BUTTERWORTH_Q.map(|q| (Coefs::low_pass(cutoff, q, rate as f32), [0.0; 2])),
            phase: 0,
            frame,
            hop: ((decimated / 100.0).round() as usize).max(1),
            pending: vec![0.0; frame / 2],
            difference: vec![0.0; frame / 2 + 1],
            fed: 0,
            hops: 0,
            group: Vec::with_capacity(HOPS_PER_VALUE),
            values: Vec::new(),
        }
    }

    pub fn push(&mut self, mono: &[f32]) {
        for &sample in mono {
            let filtered = if self.factor > 1 {
                self.lowpass
                    .iter_mut()
                    .fold(f64::from(sample), |x, (coefs, state)| coefs.tick(x, state))
                    as f32
            } else {
                sample
            };
            self.phase += 1;
            if self.phase == self.factor {
                self.phase = 0;
                self.fed += 1;
                self.pending.push(filtered);
                if self.pending.len() == self.frame {
                    self.analyse_hop();
                }
            }
        }
    }

    /// Runs the hops centred inside the stream, then stores the partial
    /// group of hops it ended in.
    pub fn finish(&mut self) {
        while self.hops < self.fed.div_ceil(self.hop as u64) {
            self.pending.resize(self.frame, 0.0);
            self.analyse_hop();
        }
        self.close_group();
    }

    /// Hz per 50 ms, 0 where unvoiced.
    pub fn values(&self) -> &[f32] {
        &self.values
    }

    fn analyse_hop(&mut self) {
        let hz = self.estimate();
        self.group.push(hz);
        self.pending.drain(..self.hop.min(self.pending.len()));
        self.hops += 1;
        if self.group.len() == HOPS_PER_VALUE {
            self.close_group();
        }
    }

    fn close_group(&mut self) {
        if self.group.is_empty() {
            return;
        }
        self.group.sort_by(f32::total_cmp);
        self.values.push(self.group[self.group.len() / 2]);
        self.group.clear();
    }

    /// The frame's pitch in Hz, one decimal, or 0.
    fn estimate(&mut self) -> f32 {
        let x = &self.pending;
        let width = self.frame / 2;
        let energy = x.iter().map(|s| s * s).sum::<f32>();
        if energy / (x.len() as f32) < VOICED_RMS * VOICED_RMS {
            return 0.0;
        }

        // d(τ) = Σ_{j<W} (x_j − x_{j+τ})² = e(0) + e(τ) − 2·r(τ), with e(τ)
        // the energy of the window starting at τ, updated incrementally.
        let head = &x[..width];
        let e0: f32 = head.iter().map(|s| s * s).sum();
        let mut shifted = e0;
        self.difference[0] = 0.0;
        for tau in 1..=width {
            shifted += x[width + tau - 1].powi(2) - x[tau - 1].powi(2);
            self.difference[tau] = (e0 + shifted - 2.0 * dot(head, &x[tau..tau + width])).max(0.0);
        }

        // The cumulative mean normalised difference, in place.
        let mut running = 0.0;
        self.difference[0] = 1.0;
        for tau in 1..=width {
            running += self.difference[tau];
            self.difference[tau] = if running > 0.0 {
                self.difference[tau] * tau as f32 / running
            } else {
                1.0
            };
        }

        let d = &self.difference;
        let Some(mut tau) = (2..width).find(|&tau| d[tau] < THRESHOLD) else {
            return 0.0;
        };
        while tau + 1 < width && d[tau + 1] < d[tau] {
            tau += 1;
        }
        let (left, centre, right) = (d[tau - 1], d[tau], d[tau + 1]);
        let curvature = left - 2.0 * centre + right;
        let shift = if curvature > 0.0 {
            (0.5 * (left - right) / curvature).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        let hz = self.rate / (tau as f32 + shift);
        (hz * 10.0).round() / 10.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::test_signals::{RATE, sine};

    fn track(signal: &[f32]) -> Vec<f32> {
        let mut pitch = PitchTrack::new(RATE);
        for chunk in signal.chunks(1000) {
            pitch.push(chunk);
        }
        pitch.finish();
        pitch.values().to_vec()
    }

    #[test]
    fn a_220_hz_sine_reads_220_on_every_voiced_value() {
        let values = track(&sine(220.0, 0.5, 2.0));
        assert_eq!(values.len(), 40);
        let voiced: Vec<f32> = values.iter().copied().filter(|&hz| hz > 0.0).collect();
        assert!(voiced.len() >= 38, "{values:?}");
        for hz in voiced {
            assert!((hz - 220.0).abs() <= 1.0, "{values:?}");
        }
    }

    #[test]
    fn silence_reads_zero() {
        assert!(track(&vec![0.0; RATE as usize]).iter().all(|&hz| hz == 0.0));
    }

    #[test]
    #[ignore = "timing probe: cargo test --release -- --ignored pitch_track"]
    fn ten_minutes_of_a_tone_tracks_in_a_few_seconds() {
        // Natively the crate's size-optimised profile leaves `dot` scalar
        // (about 2.5 s on an M-series Mac); the wasm build's simd128 lanes
        // track the same ten minutes in about 0.5 s under Bun.
        let signal: Vec<f32> = sine(220.0, 0.5, 10.0).repeat(60);
        let started = std::time::Instant::now();
        let values = track(&signal);
        let elapsed = started.elapsed();
        assert_eq!(values.len(), 12_000);
        println!("pitch track over 10 min: {elapsed:?}");
        assert!(elapsed.as_secs_f32() < 4.0);
    }
}
