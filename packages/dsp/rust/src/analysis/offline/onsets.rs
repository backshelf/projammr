//! The front end every offline analyser shares (E1): one short-time Fourier
//! transform of the mono feed, 10 ms hops, from which each hop yields a
//! 40-band log-mel vector, the spectral-flux onset strength and a 12-bin
//! chroma, plus the power spectrum the spectrogram tile reads.
//!
//! Frames are centred: hop `t` covers the samples around `t · hop`, so the
//! onset envelope's index is time in hops and a per-second mean covers the
//! hops whose centres fall in that second.

use std::sync::Arc;

use super::spectrogram::Spectrogram;
use crate::util::fft::{self, Complex, ForwardFft};
use crate::util::mel::MelBank;
use crate::util::window;

pub const MEL_BANDS: usize = 40;
pub const CHROMA_BINS: usize = 12;

/// The analysis frame at `rate`: 2048 samples at 48 kHz, scaled and rounded
/// up to the power of two the FFT needs.
pub fn frame_len(rate: u32) -> usize {
    (rate as usize * 2048)
        .div_ceil(48_000)
        .next_power_of_two()
        .max(2)
}

/// 10 ms of samples at `rate`, 480 at 48 kHz.
pub fn hop_len(rate: u32) -> usize {
    ((f64::from(rate) / 100.0).round() as usize).max(1)
}

/// The mean log-mel and chroma of the hops in one second so far.
struct Second {
    mel: [f64; MEL_BANDS],
    chroma: [f64; CHROMA_BINS],
    hops: u32,
}

impl Default for Second {
    fn default() -> Self {
        Self {
            mel: [0.0; MEL_BANDS],
            chroma: [0.0; CHROMA_BINS],
            hops: 0,
        }
    }
}

pub struct FrontEnd {
    rate: u32,
    hop: usize,
    window: Vec<f32>,
    fft: Arc<ForwardFft>,
    frame: Vec<f32>,
    bins: Vec<Complex>,
    scratch: Vec<Complex>,
    power: Vec<f32>,
    /// Scales `|X|²` so a full-scale sine's bin reads 1: a Hann window
    /// gives that bin a magnitude of `n / 4`.
    power_scale: f32,
    mel: MelBank,
    mel_power: [f32; MEL_BANDS],
    log_mel: [f32; MEL_BANDS],
    /// The bins whose peaks the chroma reads: 55 Hz to 4 kHz.
    chroma_bins: std::ops::RangeInclusive<usize>,
    bin_hz: f32,
    /// Mono samples of the frame being filled.
    pending: Vec<f32>,
    fed: u64,
    hops: u64,
    second: Second,
    second_index: u64,
    pub spectrogram: Option<Spectrogram>,
    onset: Vec<f32>,
    mel_seconds: Vec<[f32; MEL_BANDS]>,
    chroma_seconds: Vec<[f32; CHROMA_BINS]>,
    chroma_total: [f32; CHROMA_BINS],
}

impl FrontEnd {
    pub fn new(rate: u32, spectrogram: bool) -> Self {
        let n = frame_len(rate);
        let fft = fft::forward(n);
        let bin_hz = f64::from(rate) / n as f64;
        let chroma_bins =
            (55.0 / bin_hz).ceil().max(1.0) as usize..=((4000.0 / bin_hz) as usize).min(n / 2 - 1);
        Self {
            rate,
            hop: hop_len(rate),
            window: window::hann(n),
            bins: fft.make_output_vec(),
            scratch: vec![Complex::default(); fft.get_scratch_len()],
            fft,
            frame: vec![0.0; n],
            power: vec![0.0; n / 2 + 1],
            power_scale: 16.0 / (n as f32 * n as f32),
            mel: MelBank::new(rate, n, MEL_BANDS, 20.0, 16_000.0),
            mel_power: [0.0; MEL_BANDS],
            log_mel: [0.0; MEL_BANDS],
            chroma_bins,
            bin_hz: bin_hz as f32,
            pending: vec![0.0; n / 2],
            fed: 0,
            hops: 0,
            second: Second::default(),
            second_index: 0,
            spectrogram: spectrogram.then(|| Spectrogram::new(rate)),
            onset: Vec::new(),
            mel_seconds: Vec::new(),
            chroma_seconds: Vec::new(),
            chroma_total: [0.0; CHROMA_BINS],
        }
    }

    pub fn push(&mut self, mono: &[f32]) {
        if let Some(spectrogram) = &mut self.spectrogram {
            spectrogram.push(mono);
        }
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

    /// Runs the hops whose centres fall inside the stream, reading silence
    /// past its end, then smooths the onset envelope with a 3-tap mean.
    pub fn finish(&mut self) {
        let n = self.window.len();
        while self.hops < self.fed.div_ceil(self.hop as u64) {
            self.pending.resize(n, 0.0);
            self.analyse_hop();
        }
        self.close_second();
        if let Some(spectrogram) = &mut self.spectrogram {
            spectrogram.finish();
        }
        let raw = std::mem::take(&mut self.onset);
        self.onset = (0..raw.len())
            .map(|t| {
                let window = &raw[t.saturating_sub(1)..(t + 2).min(raw.len())];
                window.iter().sum::<f32>() / window.len() as f32
            })
            .collect();
    }

    /// Hops per second of the onset envelope: 100 at 48 kHz.
    pub fn hop_rate(&self) -> f32 {
        self.rate as f32 / self.hop as f32
    }

    /// Onset strength per hop, smoothed once `finish` has run.
    pub fn onset(&self) -> &[f32] {
        &self.onset
    }

    pub fn mel_seconds(&self) -> &[[f32; MEL_BANDS]] {
        &self.mel_seconds
    }

    /// Per-second chroma, each scaled so its largest bin is 1 (or all 0).
    pub fn chroma_seconds(&self) -> &[[f32; CHROMA_BINS]] {
        &self.chroma_seconds
    }

    /// Chroma power summed over the whole stream.
    pub fn chroma_total(&self) -> &[f32; CHROMA_BINS] {
        &self.chroma_total
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

        self.mel.apply(&self.power, &mut self.mel_power);
        let mut flux = 0.0;
        for (log_mel, &power) in self.log_mel.iter_mut().zip(&self.mel_power) {
            let value = (1.0 + 1000.0 * power).ln();
            flux += (value - *log_mel).max(0.0);
            *log_mel = value;
        }
        self.onset.push(flux);

        let chroma = self.chroma();

        let centre = self.hops * self.hop as u64;
        let second = centre / u64::from(self.rate);
        if second != self.second_index {
            self.close_second();
            self.second_index = second;
        }
        for (sum, &value) in self.second.mel.iter_mut().zip(&self.log_mel) {
            *sum += f64::from(value);
        }
        for ((sum, total), &value) in self
            .second
            .chroma
            .iter_mut()
            .zip(&mut self.chroma_total)
            .zip(&chroma)
        {
            *sum += f64::from(value);
            *total += value;
        }
        self.second.hops += 1;

        self.hops += 1;
    }

    /// Each spectral peak between 55 Hz and 4 kHz adds its power (the peak
    /// bin and its two neighbours) to the pitch class of its frequency,
    /// `round(12·log2(f/440)) + 69 mod 12`, with the frequency refined by a
    /// parabola through the log power: a bin is 23 Hz wide at 48 kHz, wider
    /// than a semitone below 400 Hz, so a bin's own centre misnames a low note.
    fn chroma(&self) -> [f32; CHROMA_BINS] {
        let mut chroma = [0.0f32; CHROMA_BINS];
        let p = &self.power;
        for bin in self.chroma_bins.clone() {
            let (left, centre, right) = (p[bin - 1], p[bin], p[bin + 1]);
            if centre <= 1e-10 || centre <= left || centre < right {
                continue;
            }
            let (a, b, c) = (left.max(1e-12).ln(), centre.ln(), right.max(1e-12).ln());
            let curvature = a - 2.0 * b + c;
            let shift = if curvature < 0.0 {
                (0.5 * (a - c) / curvature).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            let hz = (bin as f32 + shift) * self.bin_hz;
            let semitone = (12.0 * (hz / 440.0).log2()).round() as i32 + 69;
            chroma[semitone.rem_euclid(12) as usize] += left + centre + right;
        }
        chroma
    }

    fn close_second(&mut self) {
        let second = std::mem::take(&mut self.second);
        if second.hops == 0 {
            return;
        }
        let hops = f64::from(second.hops);
        self.mel_seconds
            .push(second.mel.map(|sum| (sum / hops) as f32));
        let peak = second.chroma.iter().copied().fold(0.0, f64::max);
        self.chroma_seconds.push(
            second
                .chroma
                .map(|sum| if peak > 0.0 { (sum / peak) as f32 } else { 0.0 }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::test_signals::{RATE, click_train, sine};

    fn run(signal: &[f32], spectrogram: bool) -> FrontEnd {
        let mut front = FrontEnd::new(RATE, spectrogram);
        for chunk in signal.chunks(4096) {
            front.push(chunk);
        }
        front.finish();
        front
    }

    #[test]
    fn frame_and_hop_follow_the_rate() {
        assert_eq!((frame_len(48_000), hop_len(48_000)), (2048, 480));
        assert_eq!((frame_len(44_100), hop_len(44_100)), (2048, 441));
        assert_eq!((frame_len(96_000), hop_len(96_000)), (4096, 960));
    }

    #[test]
    fn one_hop_per_ten_milliseconds_and_one_mean_per_second() {
        let front = run(&vec![0.0; RATE as usize * 3 + 100], true);
        assert_eq!(front.onset().len(), 301);
        assert_eq!(front.mel_seconds().len(), 4);
        assert_eq!(front.chroma_seconds().len(), 4);
        let columns = front.spectrogram.as_ref().unwrap().bytes().len() / 160;
        assert_eq!(columns, 61);
    }

    #[test]
    fn a_click_peaks_the_onset_envelope_at_its_time() {
        let front = run(&click_train(60.0, 0.5, 2.0), false);
        let onset = front.onset();
        let loudest = (0..onset.len())
            .max_by(|&a, &b| onset[a].total_cmp(&onset[b]))
            .unwrap();
        // Clicks at 0.5 s and 1.5 s are hops 50 and 150; the log-mel flux
        // rises as a click enters the frame, so it may peak a little early.
        assert!((40..=52).contains(&(loudest % 100)), "{loudest}");
    }

    #[test]
    fn an_a_440_sine_lands_in_chroma_bin_nine() {
        let front = run(&sine(440.0, 0.5, 2.0), false);
        let total = front.chroma_total();
        let loudest = (0..12)
            .max_by(|&a, &b| total[a].total_cmp(&total[b]))
            .unwrap();
        assert_eq!(loudest, 9);
        assert!(front.chroma_seconds()[0][9] == 1.0);
    }

    #[test]
    fn a_full_scale_sine_reads_near_zero_db_in_the_spectrogram() {
        let front = run(&sine(1000.0, 1.0, 1.0), true);
        let column = &front.spectrogram.as_ref().unwrap().bytes()[160 * 10..160 * 11];
        let loudest = *column.iter().max().unwrap();
        assert!(loudest >= 235, "{loudest}");
        assert!(column[0] < 20, "{}", column[0]);
    }
}
