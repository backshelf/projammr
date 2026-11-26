//! Mel filterbanks over a power spectrum: triangles evenly spaced on the mel
//! scale (`2595·log10(1 + f/700)`), each peaking at 1 on its centre.

/// One triangle: its weights over the bins from `start`.
struct Filter {
    start: usize,
    weights: Vec<f32>,
}

pub struct MelBank {
    filters: Vec<Filter>,
}

fn hz_to_mel(hz: f64) -> f64 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f64) -> f64 {
    700.0 * (10f64.powf(mel / 2595.0) - 1.0)
}

impl MelBank {
    /// `bands` triangles between `low_hz` and `high_hz` (capped at Nyquist)
    /// over the `fft_size / 2 + 1` bins of a transform at `rate`. A triangle
    /// narrower than a bin, as the lowest ones are, takes the single bin
    /// nearest its centre so that no band reads empty.
    pub fn new(rate: u32, fft_size: usize, bands: usize, low_hz: f64, high_hz: f64) -> Self {
        let bin_hz = f64::from(rate) / fft_size as f64;
        let bins = fft_size / 2 + 1;
        let high_hz = high_hz.min(f64::from(rate) / 2.0);
        let (low_mel, high_mel) = (hz_to_mel(low_hz), hz_to_mel(high_hz));
        let edge =
            |i: usize| mel_to_hz(low_mel + (high_mel - low_mel) * i as f64 / (bands + 1) as f64);

        let filters = (0..bands)
            .map(|band| {
                let (left, centre, right) = (edge(band), edge(band + 1), edge(band + 2));
                let first = ((left / bin_hz).ceil() as usize).min(bins - 1);
                let last = ((right / bin_hz).floor() as usize).min(bins - 1);
                let weights: Vec<f32> = (first..=last.max(first))
                    .map(|bin| {
                        let hz = bin as f64 * bin_hz;
                        let weight = if hz <= centre {
                            (hz - left) / (centre - left)
                        } else {
                            (right - hz) / (right - centre)
                        };
                        weight.clamp(0.0, 1.0) as f32
                    })
                    .collect();
                if weights.iter().any(|&w| w > 0.0) {
                    Filter {
                        start: first,
                        weights,
                    }
                } else {
                    let nearest = ((centre / bin_hz).round() as usize).min(bins - 1);
                    Filter {
                        start: nearest,
                        weights: vec![1.0],
                    }
                }
            })
            .collect();
        Self { filters }
    }

    pub fn bands(&self) -> usize {
        self.filters.len()
    }

    /// Writes each band's weighted power sum into `out` (`bands()` long).
    pub fn apply(&self, power: &[f32], out: &mut [f32]) {
        for (filter, band) in self.filters.iter().zip(out.iter_mut()) {
            *band = filter
                .weights
                .iter()
                .zip(&power[filter.start..])
                .map(|(w, p)| w * p)
                .sum();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_band_reads_the_bins_under_it_and_none_is_empty() {
        let bank = MelBank::new(48_000, 2048, 128, 20.0, 20_000.0);
        assert_eq!(bank.bands(), 128);
        let power = vec![1.0; 1025];
        let mut out = vec![0.0; 128];
        bank.apply(&power, &mut out);
        assert!(out.iter().all(|&band| band > 0.0));
        // Bands widen with frequency on the mel scale.
        assert!(out[127] > out[64] && out[64] > out[8]);
    }

    #[test]
    fn a_single_bin_lands_in_the_bands_whose_triangles_cover_it() {
        let bank = MelBank::new(48_000, 2048, 40, 20.0, 16_000.0);
        let mut power = vec![0.0; 1025];
        let bin = (1000.0 / (48_000.0 / 2048.0)) as usize;
        power[bin] = 1.0;
        let mut out = vec![0.0; 40];
        bank.apply(&power, &mut out);
        let lit: Vec<usize> = (0..40).filter(|&b| out[b] > 0.0).collect();
        assert!(!lit.is_empty() && lit.len() <= 2, "{lit:?}");
        let centre = mel_to_hz(
            hz_to_mel(20.0) + (hz_to_mel(16_000.0) - hz_to_mel(20.0)) * (lit[0] + 1) as f64 / 41.0,
        );
        assert!((centre - 1000.0).abs() < 200.0, "{centre}");
    }
}
