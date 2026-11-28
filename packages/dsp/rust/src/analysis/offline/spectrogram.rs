//! The spectrogram tile (E5): 160 log-spaced bands (20 Hz – 20 kHz), one
//! column per 50 ms over a 4096-pt Hann STFT at 10 ms hops with +4.0 dB/oct
//! spectral tilt around 1 kHz, peak-weighted hop aggregation
//! (`0.65 * max + 0.35 * mean`), clamped to [−80, 0] dB and quantised to `u8`.

use std::sync::Arc;

use crate::util::fft::{self, Complex, ForwardFft};
use crate::util::window;

pub const SPECTROGRAM_BANDS: usize = 160;
pub const SPECTROGRAM_LOW_HZ: f64 = 20.0;
pub const SPECTROGRAM_HIGH_HZ: f64 = 20_000.0;
pub const SPECTROGRAM_TILT_DB_PER_OCTAVE: f64 = 4.0;
pub const SPECTROGRAM_FLOOR_DB: f64 = -80.0;
pub const SPECTROGRAM_CEIL_DB: f64 = 0.0;

/// The spectrogram analysis frame at `rate`: 4096 samples at 48 kHz, scaled
/// and rounded up to the power of two the FFT needs.
fn frame_len(rate: u32) -> usize {
    (rate as usize * 4096)
        .div_ceil(48_000)
        .next_power_of_two()
        .max(2)
}

/// 10 ms of samples at `rate`, 480 at 48 kHz (5 hops per 50 ms column).
fn hop_len(rate: u32) -> usize {
    ((f64::from(rate) / 100.0).round() as usize).max(1)
}

pub struct Spectrogram {
    rate: u32,
    hop: usize,
    window: Vec<f32>,
    fft: Arc<ForwardFft>,
    frame: Vec<f32>,
    bins: Vec<Complex>,
    scratch: Vec<Complex>,
    power: Vec<f32>,
    power_scale: f32,
    first: [usize; SPECTROGRAM_BANDS],
    last: [usize; SPECTROGRAM_BANDS],
    tilt_gain: [f64; SPECTROGRAM_BANDS],
    pending: Vec<f32>,
    fed: u64,
    hops: u64,
    sum: [f64; SPECTROGRAM_BANDS],
    max: [f64; SPECTROGRAM_BANDS],
    hops_in_col: u32,
    column: u64,
    bytes: Vec<u8>,
}

impl Spectrogram {
    /// 160 log-spaced bands from 20 Hz to 20 kHz over a 4096-pt Hann STFT.
    pub fn new(rate: u32) -> Self {
        let n = frame_len(rate);
        let half = n >> 1;
        let fft = fft::forward(n);

        let ratio =
            (SPECTROGRAM_HIGH_HZ / SPECTROGRAM_LOW_HZ).powf(1.0 / (SPECTROGRAM_BANDS as f64 - 1.0));
        let edge = ratio.sqrt();
        let nyquist = f64::from(rate) / 2.0;

        let mut first = [1usize; SPECTROGRAM_BANDS];
        let mut last = [0usize; SPECTROGRAM_BANDS];
        let mut tilt_gain = [1.0f64; SPECTROGRAM_BANDS];

        for b in 0..SPECTROGRAM_BANDS {
            let fc = SPECTROGRAM_LOW_HZ * ratio.powi(b as i32);
            let low = fc / edge;
            if low > nyquist {
                // Leave last[b] < first[b] so bands past Nyquist read at the floor.
                continue;
            }
            let high = fc * edge;
            let mut k0 = (low * n as f64 / f64::from(rate)).ceil();
            let mut k1 = (high * n as f64 / f64::from(rate)).floor();
            if k1 < k0 {
                let k = (fc * n as f64 / f64::from(rate)).round();
                k0 = k;
                k1 = k;
            }
            let k0 = (k0 as i64).clamp(1, half as i64) as usize;
            let k1 = (k1 as i64).max(k0 as i64).min(half as i64) as usize;
            first[b] = k0;
            last[b] = k1;
            let tilt_db = SPECTROGRAM_TILT_DB_PER_OCTAVE * (fc / 1000.0).log2();
            tilt_gain[b] = 10f64.powf(tilt_db / 10.0);
        }

        Self {
            rate,
            hop: hop_len(rate),
            window: window::hann(n),
            bins: fft.make_output_vec(),
            scratch: vec![Complex::default(); fft.get_scratch_len()],
            fft,
            frame: vec![0.0; n],
            power: vec![0.0; half + 1],
            power_scale: 16.0 / (n as f32 * n as f32),
            first,
            last,
            tilt_gain,
            pending: vec![0.0; half],
            fed: 0,
            hops: 0,
            sum: [0.0; SPECTROGRAM_BANDS],
            max: [0.0; SPECTROGRAM_BANDS],
            hops_in_col: 0,
            column: 0,
            bytes: Vec::new(),
        }
    }

    pub fn push(&mut self, mono: &[f32]) {
        self.fed += mono.len() as u64;
        let n = self.window.len();
        let mut rest = mono;
        while !rest.is_empty() {
            let take = (n - self.pending.len()).min(rest.len());
            self.pending.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.pending.len() == n {
                self.analyse_hop();
            }
        }
    }

    pub fn finish(&mut self) {
        let n = self.window.len();
        while self.hops < self.fed.div_ceil(self.hop as u64) {
            self.pending.resize(n, 0.0);
            self.analyse_hop();
        }
        self.close();
    }

    /// Column-major: `SPECTROGRAM_BANDS` bytes per 50 ms column, lowest band
    /// first; 0 is −80 dB and below, 255 is 0 dB and above.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn analyse_hop(&mut self) {
        for ((out, &sample), &w) in self.frame.iter_mut().zip(&self.pending).zip(&self.window) {
            *out = sample * w;
        }
        self.pending.drain(..self.hop.min(self.pending.len()));
        // The buffers are sized for the plan, so this cannot fail.
        let _ = self
            .fft
            .process_with_scratch(&mut self.frame, &mut self.bins, &mut self.scratch);
        for (p, bin) in self.power.iter_mut().zip(&self.bins) {
            *p = (bin.re * bin.re + bin.im * bin.im) * self.power_scale;
        }

        let centre = self.hops * self.hop as u64;
        let column = centre * 20 / u64::from(self.rate);
        if column != self.column {
            self.close();
            self.column = column;
        }

        for b in 0..SPECTROGRAM_BANDS {
            let k0 = self.first[b];
            let k1 = self.last[b];
            let tilted = if k1 < k0 {
                0.0
            } else {
                let bin_count = (k1 - k0 + 1) as f64;
                let total: f64 = self.power[k0..=k1].iter().map(|&p| f64::from(p)).sum();
                (total / bin_count) * self.tilt_gain[b]
            };
            self.sum[b] += tilted;
            if tilted > self.max[b] {
                self.max[b] = tilted;
            }
        }
        self.hops_in_col += 1;
        self.hops += 1;
    }

    fn close(&mut self) {
        if self.hops_in_col == 0 {
            return;
        }
        let hops = f64::from(self.hops_in_col);
        let span = SPECTROGRAM_CEIL_DB - SPECTROGRAM_FLOOR_DB;
        for b in 0..SPECTROGRAM_BANDS {
            let mean = self.sum[b] / hops;
            let agg = 0.65 * self.max[b] + 0.35 * mean;
            let db = (10.0 * agg.max(1e-12).log10()).clamp(SPECTROGRAM_FLOOR_DB, SPECTROGRAM_CEIL_DB);
            self.bytes
                .push(((db - SPECTROGRAM_FLOOR_DB) / span * 255.0).round() as u8);
            self.sum[b] = 0.0;
            self.max[b] = 0.0;
        }
        self.hops_in_col = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::test_signals::{RATE, noise, sine};

    fn run(signal: &[f32]) -> Spectrogram {
        let mut spec = Spectrogram::new(RATE);
        for chunk in signal.chunks(4096) {
            spec.push(chunk);
        }
        spec.finish();
        spec
    }

    #[test]
    fn emits_160_bands_per_50_ms_column() {
        let spec = run(&vec![0.0; RATE as usize * 3 + 100]);
        assert_eq!(spec.bytes().len() % SPECTROGRAM_BANDS, 0);
        assert_eq!(spec.bytes().len() / SPECTROGRAM_BANDS, 61);
        assert!(spec.bytes().iter().all(|&b| b == 0));
    }

    #[test]
    fn white_noise_follows_the_configured_spectral_tilt() {
        let spec = run(&noise(2.0, 0.2, 42));
        let cols = spec.bytes().len() / SPECTROGRAM_BANDS;
        let ratio =
            (SPECTROGRAM_HIGH_HZ / SPECTROGRAM_LOW_HZ).powf(1.0 / (SPECTROGRAM_BANDS as f64 - 1.0));
        let db_of = |byte: u8| {
            SPECTROGRAM_FLOOR_DB
                + (f64::from(byte) / 255.0) * (SPECTROGRAM_CEIL_DB - SPECTROGRAM_FLOOR_DB)
        };

        let mut n = 0.0;
        let (mut sx, mut sy, mut sxy, mut sxx) = (0.0, 0.0, 0.0, 0.0);
        for b in 0..SPECTROGRAM_BANDS {
            let hz = SPECTROGRAM_LOW_HZ * ratio.powi(b as i32);
            if !(100.0..=10_000.0).contains(&hz) {
                continue;
            }
            let mean_db: f64 = (4..cols - 4)
                .map(|c| db_of(spec.bytes()[c * SPECTROGRAM_BANDS + b]))
                .sum::<f64>()
                / (cols - 8) as f64;
            let x = hz.log2();
            n += 1.0;
            sx += x;
            sy += mean_db;
            sxy += x * mean_db;
            sxx += x * x;
        }
        let slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        assert!(
            (slope - SPECTROGRAM_TILT_DB_PER_OCTAVE).abs() <= 0.5,
            "slope={slope}"
        );
    }

    #[test]
    fn peak_weighted_hops_preserve_short_transients() {
        let mut signal = vec![0.0; RATE as usize];
        // A 10 ms 2 kHz burst inside the column at 0.50 s
        let burst_start = RATE as usize / 2;
        let burst_len = RATE as usize / 100;
        let burst = sine(2000.0, 0.8, 0.01);
        signal[burst_start..burst_start + burst_len].copy_from_slice(&burst[..burst_len]);

        let spec = run(&signal);
        let col_idx = 10; // 0.50 s at 50 ms/col
        let col = &spec.bytes()[col_idx * SPECTROGRAM_BANDS..(col_idx + 1) * SPECTROGRAM_BANDS];
        let peak = *col.iter().max().unwrap();
        assert!(peak >= 190, "transient peak washed out: {peak}");
    }
}
