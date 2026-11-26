//! Long-term average spectrum: a Hann-windowed FFT meter on the crate's own
//! radix-2 FFT (`util::fft`). `SPECTRUM_LAYOUT` (`packages/dsp/src/spectrum.ts`)
//! stays the single source of the band table; this module only ever sees the
//! five numbers `analysis_spectrum_layout` passes in.

use crate::error::DspError;
use crate::util::fft::FftPair;
use crate::util::window::hann;

/// The five numbers `SPECTRUM_LAYOUT` (`packages/dsp/src/spectrum.ts`) holds,
/// carried in rather than duplicated so the TypeScript constant stays the
/// single source of what a stored curve means.
pub struct SpectrumLayout {
    pub bands: usize,
    pub low_hz: f64,
    pub high_hz: f64,
    pub fft_size: usize,
    pub tilt_db_per_octave: f64,
    pub floor_db: f64,
}

/// A short-time spectrum analyser on `layout`'s bands, fed streaming audio
/// and read back two ways: `take_latest` the newest window once per hop
/// (the live readout, C6), `average` the mean over every window fed so far,
/// recomputed on every call (the stored LTAS, C4) — there is no separate
/// finalising step, so a caller never reads a stale or default curve
/// between pushes.
pub struct Spectrum {
    layout: SpectrumLayout,
    n: usize,
    hop: usize,
    window: Vec<f32>,
    frame_norm: f64,
    first: Vec<usize>,
    last: Vec<usize>,
    tilt: Vec<f64>,
    fft: FftPair,
    ring: Vec<f32>,
    filled: usize,
    /// Power per bin of the newest window.
    latest: Vec<f64>,
    /// Power per bin summed over every window fed so far.
    sum: Vec<f64>,
    frames: u64,
    fresh: bool,
    latest_out: Vec<f32>,
    average_out: Vec<f32>,
}

impl Spectrum {
    pub fn new(sample_rate: u32, layout: SpectrumLayout) -> Result<Self, DspError> {
        if layout.bands == 0
            || layout.fft_size < 2
            || !layout.fft_size.is_power_of_two()
            || layout.low_hz <= 0.0
            || layout.high_hz <= layout.low_hz
            || sample_rate == 0
        {
            return Err(DspError::BadArgument);
        }

        let n = layout.fft_size;
        let half = n >> 1;
        let hop = n >> 1;
        let bands = layout.bands;

        let window = hann(n);
        let window_sum: f64 = window.iter().map(|&w| f64::from(w)).sum();
        let frame_norm = 1.0 / ((window_sum / 2.0) * (window_sum / 2.0));

        let ratio = (layout.high_hz / layout.low_hz).powf(1.0 / (bands as f64 - 1.0));
        let edge = ratio.sqrt();
        let mut first = vec![0usize; bands];
        let mut last = vec![0usize; bands];
        let mut tilt = vec![0.0f64; bands];
        for b in 0..bands {
            let fc = layout.low_hz * ratio.powi(b as i32);
            let mut k0 = ((fc / edge) * n as f64 / f64::from(sample_rate)).ceil();
            let mut k1 = ((fc * edge) * n as f64 / f64::from(sample_rate)).floor();
            if k1 < k0 {
                let k = (fc * n as f64 / f64::from(sample_rate)).round();
                k0 = k;
                k1 = k;
            }
            let k0 = (k0 as i64).clamp(1, half as i64) as usize;
            let k1 = (k1 as i64).max(k0 as i64).min(half as i64) as usize;
            first[b] = k0;
            last[b] = k1;
            tilt[b] = layout.tilt_db_per_octave * (fc / 1000.0).log2();
        }

        Ok(Self {
            n,
            hop,
            window,
            frame_norm,
            first,
            last,
            tilt,
            fft: FftPair::new(n),
            ring: vec![0.0; n],
            filled: 0,
            latest: vec![0.0; half + 1],
            sum: vec![0.0; half + 1],
            frames: 0,
            fresh: false,
            latest_out: vec![layout.floor_db as f32; bands],
            average_out: vec![layout.floor_db as f32; bands],
            layout,
        })
    }

    /// Feeds interleaved samples, mixed to mono with equal weight per
    /// channel.
    pub fn push(&mut self, interleaved: &[f32], channels: u32) {
        let channels = channels as usize;
        for frame in interleaved.chunks_exact(channels) {
            let mono = frame.iter().sum::<f32>() / channels as f32;
            self.ring[self.filled] = mono;
            self.filled += 1;
            if self.filled == self.n {
                self.analyse();
            }
        }
    }

    /// The newest window's band levels, once per hop; `None` until a hop has
    /// closed since the last call.
    pub fn take_latest(&mut self) -> Option<&[f32]> {
        if !self.fresh {
            return None;
        }
        self.fresh = false;
        Some(&self.latest_out)
    }

    /// The mean over every window fed so far, rounded to one decimal;
    /// `None` before the first full window.
    /// Recomputed from `sum` on every call, so it is never stale: a window
    /// that closes between two calls is reflected in the very next one, with
    /// no separate finalising step to remember to invoke first.
    pub fn average(&mut self) -> Option<&[f32]> {
        if self.frames == 0 {
            return None;
        }
        let scale = self.frame_norm / self.frames as f64;
        Self::to_bands(
            self.layout.bands,
            &self.first,
            &self.last,
            &self.tilt,
            self.layout.floor_db,
            &self.sum,
            scale,
            &mut self.average_out,
        );
        for value in &mut self.average_out {
            *value = round1(*value);
        }
        Some(&self.average_out)
    }

    fn analyse(&mut self) {
        let mut input: Vec<f32> = self
            .ring
            .iter()
            .zip(&self.window)
            .map(|(&sample, &window)| sample * window)
            .collect();
        let mut spectrum = self.fft.forward.make_output_vec();
        // SAFETY net: a fixed-size real FFT plan never rejects a full-length
        // real input, so this only fails on a programming error.
        self.fft
            .forward
            .process(&mut input, &mut spectrum)
            .expect("forward FFT of a full window never fails");
        for ((bin, latest), sum) in spectrum.iter().zip(&mut self.latest).zip(&mut self.sum) {
            let power =
                f64::from(bin.re) * f64::from(bin.re) + f64::from(bin.im) * f64::from(bin.im);
            *latest = power;
            *sum += power;
        }
        self.frames += 1;
        Self::to_bands(
            self.layout.bands,
            &self.first,
            &self.last,
            &self.tilt,
            self.layout.floor_db,
            &self.latest,
            self.frame_norm,
            &mut self.latest_out,
        );
        self.fresh = true;

        self.ring.copy_within(self.hop..self.n, 0);
        self.filled = self.n - self.hop;
    }

    /// Mean power per bin inside each band, scaled, in tilted dB. A free
    /// function (not a `&self` method) so a caller can pass `out` as a
    /// `&mut` into another field of the same struct without a borrow
    /// conflict against the band table it also reads.
    #[allow(clippy::too_many_arguments)]
    fn to_bands(
        bands: usize,
        first: &[usize],
        last: &[usize],
        tilt: &[f64],
        floor_db: f64,
        power: &[f64],
        scale: f64,
        out: &mut [f32],
    ) {
        for b in 0..bands {
            let bin_count = last[b] - first[b] + 1;
            let total: f64 = power[first[b]..=last[b]].iter().sum();
            let mean = (total / bin_count as f64) * scale;
            let db = if mean > 0.0 {
                10.0 * mean.log10() + tilt[b]
            } else {
                floor_db
            };
            out[b] = (if db < floor_db { floor_db } else { db }) as f32;
        }
    }
}

fn round1(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: u32 = 48_000;

    fn layout() -> SpectrumLayout {
        SpectrumLayout {
            bands: 96,
            low_hz: 20.0,
            high_hz: 20_000.0,
            fft_size: 8192,
            tilt_db_per_octave: 4.5,
            floor_db: -120.0,
        }
    }

    fn meter() -> Spectrum {
        Spectrum::new(SAMPLE_RATE, layout()).unwrap()
    }

    fn sine(hz: f32, amplitude: f32, length: usize, offset: usize) -> Vec<f32> {
        (0..length)
            .map(|i| {
                amplitude
                    * (2.0 * core::f32::consts::PI * hz * (i + offset) as f32 / SAMPLE_RATE as f32)
                        .sin()
            })
            .collect()
    }

    fn white_noise(length: usize, amplitude: f32) -> Vec<f32> {
        let mut seed: u32 = 0x2545_f491;
        (0..length)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((seed as f64 / 0x1_0000_0000_u64 as f64) * 2.0 - 1.0) as f32 * amplitude
            })
            .collect()
    }

    fn band_centres(layout: &SpectrumLayout) -> Vec<f64> {
        let ratio = (layout.high_hz / layout.low_hz).powf(1.0 / (layout.bands as f64 - 1.0));
        (0..layout.bands)
            .map(|b| layout.low_hz * ratio.powi(b as i32))
            .collect()
    }

    fn loudest_band(db: &[f32]) -> usize {
        let mut peak = 0;
        for b in 1..db.len() {
            if db[b] > db[peak] {
                peak = b;
            }
        }
        peak
    }

    #[test]
    fn a_440_hz_sine_peaks_in_the_band_nearest_440_hz() {
        let mut target = meter();
        target.push(&sine(440.0, 0.5, SAMPLE_RATE as usize, 0), 1);

        let centres = band_centres(&layout());
        let peak = loudest_band(target.average().unwrap());
        assert!((centres[peak] / 440.0).log2().abs() < 0.1);
    }

    #[test]
    fn a_440_hz_sine_leaves_every_band_two_away_at_least_40_db_down() {
        let mut target = meter();
        target.push(&sine(440.0, 0.5, SAMPLE_RATE as usize, 0), 1);

        let curve = target.average().unwrap();
        let peak = loudest_band(curve);
        for (b, &db) in curve.iter().enumerate() {
            if (b as i64 - peak as i64).abs() <= 2 {
                continue;
            }
            assert!(
                db <= curve[peak] - 40.0,
                "band {b} = {db}, peak = {}",
                curve[peak]
            );
        }
    }

    #[test]
    fn white_noise_reads_as_a_line_at_the_layouts_tilt() {
        let mut target = meter();
        target.push(&white_noise(SAMPLE_RATE as usize * 4, 0.2), 1);

        let centres = band_centres(&layout());
        let curve = target.average().unwrap();
        let mut n = 0.0;
        let (mut sx, mut sy, mut sxy, mut sxx) = (0.0, 0.0, 0.0, 0.0);
        for (b, &hz) in centres.iter().enumerate() {
            if !(100.0..=10_000.0).contains(&hz) {
                continue;
            }
            let x = hz.log2();
            let y = f64::from(curve[b]);
            n += 1.0;
            sx += x;
            sy += y;
            sxy += x * y;
            sxx += x * x;
        }
        let slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        assert!(
            (slope - layout().tilt_db_per_octave).abs() <= 0.3,
            "{slope}"
        );
    }

    #[test]
    fn silence_reads_at_the_floor_in_every_band() {
        let mut target = meter();
        target.push(&vec![0.0; SAMPLE_RATE as usize], 1);

        assert_eq!(target.average().unwrap().len(), 96);
        for &db in target.average().unwrap() {
            assert_eq!(db, layout().floor_db as f32);
        }
    }

    #[test]
    fn take_latest_reports_one_frame_per_hop_and_nothing_before_the_first_window() {
        let mut target = meter();
        let size = layout().fft_size;
        let hop = size / 2;

        target.push(&sine(1000.0, 0.5, size - 1, 0), 1);
        assert!(target.take_latest().is_none());

        target.push(&sine(1000.0, 0.5, 1, size - 1), 1);
        assert!(target.take_latest().is_some());
        assert!(target.take_latest().is_none());

        target.push(&sine(1000.0, 0.5, hop - 1, size), 1);
        assert!(target.take_latest().is_none());

        target.push(&sine(1000.0, 0.5, 1, size + hop - 1), 1);
        assert!(target.take_latest().is_some());
    }

    #[test]
    fn the_average_covers_the_whole_signal_not_the_newest_window() {
        let mut target = meter();

        target.push(&sine(440.0, 0.5, SAMPLE_RATE as usize, 0), 1);
        let frame: Vec<f32> = target.take_latest().unwrap().to_vec();
        let peak = loudest_band(&frame);

        target.push(
            &sine(440.0, 0.5, SAMPLE_RATE as usize, SAMPLE_RATE as usize),
            1,
        );
        target.push(&vec![0.0; SAMPLE_RATE as usize * 2], 1);

        let curve = target.average().unwrap();
        let drop = frame[peak] - curve[peak];
        assert!((drop - 3.0).abs() <= 0.5, "{drop}");
    }

    #[test]
    fn the_average_is_none_before_the_first_full_window() {
        let mut target = meter();
        target.push(&white_noise(1024, 0.2), 1);
        assert!(target.average().is_none());
    }

    #[test]
    fn the_average_updates_on_every_call_with_no_separate_finalising_step() {
        let mut target = meter();
        let silence = target.average();
        assert!(silence.is_none());

        target.push(&sine(440.0, 0.5, SAMPLE_RATE as usize, 0), 1);
        let after_one_second = target.average().unwrap().to_vec();
        // A full window closed, so the average must already reflect it: it
        // must not still read the layout's floor everywhere, which is what
        // an unpopulated `average_out` buffer would show.
        assert!(
            after_one_second
                .iter()
                .any(|&db| db > layout().floor_db as f32)
        );

        target.push(&vec![0.0; SAMPLE_RATE as usize * 3], 1);
        let after_more_silence = target.average().unwrap().to_vec();
        // Diluting the sine with three more seconds of silence must change
        // the reading on this call alone, with no `finish()` in between.
        assert_ne!(after_one_second, after_more_silence);
    }

    #[test]
    fn construction_rejects_a_fft_size_that_is_not_a_power_of_two() {
        let mut bad = layout();
        bad.fft_size = 100;
        assert_eq!(
            Spectrum::new(SAMPLE_RATE, bad).err(),
            Some(DspError::BadArgument)
        );
    }
}
