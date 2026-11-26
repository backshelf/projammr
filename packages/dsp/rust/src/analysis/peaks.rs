//! Waveform peaks: one magnitude per 50 ms of playing time, mono, 0..1.
//!
//! 20 bins per second, each the magnitude of the loudest sample in the
//! window it covers, kept fixed so a stored curve's meaning does not
//! change.

/// Bins the stream into 50 ms windows and keeps the magnitude of each
/// window's extreme sample.
pub struct Peaks {
    per_bin: usize,
    fill: usize,
    extreme: f32,
    out: Vec<f32>,
}

impl Peaks {
    pub fn new(rate: u32) -> Self {
        Self {
            // A bin is never empty: below 20 Hz there is no real audio to bin.
            per_bin: ((rate / 20) as usize).max(1),
            fill: 0,
            extreme: 0.0,
            out: Vec::new(),
        }
    }

    pub fn push(&mut self, interleaved: &[f32], channels: u32) {
        let channels = channels as usize;
        for frame in interleaved.chunks_exact(channels) {
            let mono = frame.iter().sum::<f32>() / channels as f32;
            let magnitude = mono.abs();
            if magnitude > self.extreme {
                self.extreme = magnitude;
            }
            self.fill += 1;
            if self.fill == self.per_bin {
                self.close();
            }
        }
    }

    /// A trailing partial bin counts: a 3.02 s file has 61 values.
    pub fn finish(&mut self) {
        if self.fill > 0 {
            self.close();
        }
    }

    pub fn values(&self) -> &[f32] {
        &self.out
    }

    fn close(&mut self) {
        self.out
            .push((self.extreme.min(1.0) * 1000.0).round() / 1000.0);
        self.extreme = 0.0;
        self.fill = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
        let n = (RATE as f32 * seconds) as usize;
        (0..n)
            .map(|i| amplitude * (2.0 * core::f32::consts::PI * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    #[test]
    fn a_half_amplitude_sine_for_one_second_gives_twenty_bins_of_half() {
        let mut peaks = Peaks::new(RATE);
        peaks.push(&sine(1000.0, 0.5, 1.0), 1);
        peaks.finish();

        assert_eq!(peaks.values().len(), 20);
        for &value in peaks.values() {
            assert!((value - 0.5).abs() < 0.001, "{value}");
        }
    }

    #[test]
    fn a_short_file_gives_one_bin_per_fifty_milliseconds() {
        let mut peaks = Peaks::new(RATE);
        peaks.push(&sine(1000.0, 0.5, 0.3), 1);
        peaks.finish();

        assert_eq!(peaks.values().len(), 6);
    }

    #[test]
    fn a_trailing_partial_bin_counts() {
        let mut peaks = Peaks::new(RATE);
        // 0.05 s is one full bin at 48 kHz; one extra sample starts a partial one.
        let mut samples = sine(1000.0, 0.5, 0.05);
        samples.push(0.9);
        peaks.push(&samples, 1);
        peaks.finish();

        assert_eq!(peaks.values().len(), 2);
        assert!((peaks.values()[1] - 0.9).abs() < 0.001);
    }

    #[test]
    fn a_full_scale_square_wave_reads_one() {
        let mut peaks = Peaks::new(RATE);
        let square: Vec<f32> = (0..RATE / 20)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        peaks.push(&square, 1);
        peaks.finish();

        assert_eq!(peaks.values(), &[1.0]);
    }

    #[test]
    fn silence_reads_zero() {
        let mut peaks = Peaks::new(RATE);
        peaks.push(&vec![0.0; RATE as usize], 1);
        peaks.finish();

        assert!(peaks.values().iter().all(|&value| value == 0.0));
    }

    #[test]
    fn stereo_frames_mix_to_mono_with_equal_weight() {
        let mut peaks = Peaks::new(RATE);
        // Left at +0.8, right at -0.4: the mono mix is +0.2 in magnitude.
        let mut interleaved = Vec::new();
        for _ in 0..(RATE / 20) {
            interleaved.push(0.8);
            interleaved.push(-0.4);
        }
        peaks.push(&interleaved, 2);
        peaks.finish();

        assert_eq!(peaks.values().len(), 1);
        assert!((peaks.values()[0] - 0.2).abs() < 0.001);
    }

    #[test]
    fn finish_is_a_no_op_on_an_empty_bin() {
        let mut peaks = Peaks::new(RATE);
        peaks.push(&sine(1000.0, 0.5, 0.05), 1);
        peaks.finish();
        let before = peaks.values().len();
        peaks.finish();
        assert_eq!(peaks.values().len(), before);
    }
}
