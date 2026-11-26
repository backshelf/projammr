//! Comparing two versions from their stored features (E11): the offset that
//! aligns their onset envelopes, then per second the change in their log-mel
//! means and loudness, a summary, and how alike their fingerprints are.

use super::fingerprint::dequantise;
use super::onsets::{CHROMA_BINS, MEL_BANDS};
use crate::error::DspError;

/// The onset envelope's rate: one strength per 10 ms hop.
pub const ONSET_RATE_HZ: f32 = 100.0;
/// The widest offset alignment searches, either way.
const MAX_OFFSET_S: f32 = 30.0;
/// The least overlap an offset is scored on.
const MIN_OVERLAP_S: f32 = 5.0;
/// A best normalised cross-correlation below this aligns nothing.
const MIN_ALIGNMENT: f32 = 0.3;
/// A second changed more than this counts as changed.
const CHANGED: f32 = 0.15;
/// The loudest change is the longest run of seconds changed more than this.
const LOUDEST: f32 = 0.3;
/// A silent (gated) second's loudness in a difference.
const FLOOR_LUFS: f32 = -70.0;
/// The log-mel value, `ln(1 + 1000·p)`, of a band holding a −60 dBFS sine
/// (`p = 10⁻⁶`): the silence level the curves use.
const SILENT_LOG_MEL: f32 = 1e-3;

/// Which stored series a buffer holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Series {
    /// Onset strength per 10 ms.
    Onset,
    /// 40 log-mel band means per second.
    Mel,
    /// 12-bin chroma per second: the fingerprint.
    Chroma,
}

impl Series {
    pub fn from_id(id: u32) -> Result<Self, DspError> {
        match id {
            0 => Ok(Self::Onset),
            1 => Ok(Self::Mel),
            2 => Ok(Self::Chroma),
            _ => Err(DspError::BadArgument),
        }
    }

    pub fn width(self) -> usize {
        match self {
            Self::Onset => 1,
            Self::Mel => MEL_BANDS,
            Self::Chroma => CHROMA_BINS,
        }
    }
}

/// One version's features, read back from their stored bytes.
#[derive(Default)]
pub struct Features {
    onset: Vec<f32>,
    mel: Vec<f32>,
    chroma: Vec<f32>,
    loudness: Vec<f32>,
    /// A log-mel row whose every band is at or below this is silent.
    mel_floor: f32,
    /// A chroma row whose every bin is at or below this is silent.
    chroma_floor: f32,
}

impl Features {
    /// Loads `bytes` quantised over `[min, max]` as `series`. A row within
    /// one quantisation step of zero cannot be told from silence, so that
    /// step (or, for log-mel, the −60 dBFS level if higher) is the series'
    /// silence floor. `BadArgument` when the length is not a whole number of
    /// values or the range is not finite and ordered.
    pub fn set(
        &mut self,
        series: Series,
        bytes: &[u8],
        min: f32,
        max: f32,
    ) -> Result<(), DspError> {
        if !bytes.len().is_multiple_of(series.width())
            || !(min.is_finite() && max.is_finite() && min <= max)
        {
            return Err(DspError::BadArgument);
        }
        let values = dequantise(bytes, min, max);
        let step = (max - min) / 255.0;
        match series {
            Series::Onset => self.onset = values,
            Series::Mel => {
                self.mel = values;
                self.mel_floor = step.max(SILENT_LOG_MEL);
            }
            Series::Chroma => {
                self.chroma = values;
                self.chroma_floor = step;
            }
        }
        Ok(())
    }

    /// Loads the short-term loudness per second (LUFS, `-inf` or NaN where
    /// gated) the loudness delta reads.
    pub fn set_loudness(&mut self, lufs: &[f32]) {
        self.loudness = lufs
            .iter()
            .map(|&v| {
                if v.is_finite() {
                    v.max(FLOOR_LUFS)
                } else {
                    FLOOR_LUFS
                }
            })
            .collect();
    }
}

/// The offset in milliseconds at which `b` best matches `a` (a positive
/// offset means `b` plays the same material later), or `None` when no offset
/// within ±30 s correlates at 0.3 or more over at least 5 s.
pub fn align(a: &Features, b: &Features) -> Option<i32> {
    let standardise = |v: &[f32]| {
        let n = v.len().max(1) as f32;
        let mean = v.iter().sum::<f32>() / n;
        let deviation = (v.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / n)
            .sqrt()
            .max(1e-9);
        v.iter().map(|x| (x - mean) / deviation).collect::<Vec<_>>()
    };
    let (x, y) = (standardise(&a.onset), standardise(&b.onset));
    let max_lag = (MAX_OFFSET_S * ONSET_RATE_HZ) as isize;
    let min_overlap = (MIN_OVERLAP_S * ONSET_RATE_HZ) as usize;

    let mut best = (0isize, f32::MIN);
    for lag in -max_lag..=max_lag {
        // x[i] pairs with y[i + lag].
        let start = (-lag).max(0) as usize;
        let end = (y.len() as isize - lag).clamp(0, x.len() as isize) as usize;
        if end < start + min_overlap {
            continue;
        }
        let from = (start as isize + lag) as usize;
        let score = super::dot(&x[start..end], &y[from..from + end - start]) / (end - start) as f32;
        if score > best.1 {
            best = (lag, score);
        }
    }
    (best.1 >= MIN_ALIGNMENT).then(|| (best.0 as f32 / ONSET_RATE_HZ * 1000.0).round() as i32)
}

pub struct Diff {
    /// Per second of `a`, 0..1, two decimals; 1 where `b` has no counterpart.
    pub change: Vec<f32>,
    /// Per second of `a`, LU, one decimal; empty unless both loudness curves
    /// were loaded.
    pub loudness_delta: Vec<f32>,
    /// `[changedSeconds, changedShare, loudestStartMs, loudestEndMs,
    /// fingerprintSimilarity]`: the loudest change's bounds are −1 when no
    /// second changed more than 0.3, and the similarity (the mean cosine of
    /// the aligned per-second chroma) is NaN without both fingerprints.
    pub summary: [f32; 5],
}

/// Linear interpolation of `b`'s `width`-wide rows at second `u`, or `None`
/// where `u` rounds outside `b`.
fn row_at(values: &[f32], width: usize, u: f32) -> Option<Vec<f32>> {
    let rows = values.len() / width;
    let nearest = u.round();
    if rows == 0 || nearest < 0.0 || nearest >= rows as f32 {
        return None;
    }
    let lower = (u.floor().max(0.0) as usize).min(rows - 1);
    let upper = (lower + 1).min(rows - 1);
    let t = (u - lower as f32).clamp(0.0, 1.0);
    let (p, q) = (
        &values[lower * width..][..width],
        &values[upper * width..][..width],
    );
    Some(p.iter().zip(q).map(|(p, q)| p + (q - p) * t).collect())
}

/// How alike two rows are, 0..1 for non-negative features: 1 when both are
/// silent (every value at or below its floor), 0 when only one is, otherwise
/// their cosine.
fn similarity(x: &[f32], x_floor: f32, y: &[f32], y_floor: f32) -> f32 {
    let silent = |v: &[f32], floor: f32| v.iter().all(|&value| value <= floor);
    match (silent(x, x_floor), silent(y, y_floor)) {
        (true, true) => 1.0,
        (true, false) | (false, true) => 0.0,
        (false, false) => {
            let norm = |v: &[f32]| super::dot(v, v).sqrt().max(1e-9);
            super::dot(x, y) / (norm(x) * norm(y))
        }
    }
}

/// Compares `a` with `b` placed `offset_ms` later.
pub fn diff(a: &Features, b: &Features, offset_ms: i32) -> Diff {
    let offset_s = offset_ms as f32 / 1000.0;
    let change: Vec<f32> = a
        .mel
        .chunks_exact(MEL_BANDS)
        .enumerate()
        .map(
            |(t, x)| match row_at(&b.mel, MEL_BANDS, t as f32 + offset_s) {
                Some(y) => {
                    let alike = similarity(x, a.mel_floor, &y, b.mel_floor);
                    ((1.0 - alike).clamp(0.0, 1.0) * 100.0).round() / 100.0
                }
                None => 1.0,
            },
        )
        .collect();

    let loudness_delta = if a.loudness.is_empty() || b.loudness.is_empty() {
        Vec::new()
    } else {
        a.loudness
            .iter()
            .enumerate()
            .map(|(t, &la)| {
                let lb = row_at(&b.loudness, 1, t as f32 + offset_s).map_or(FLOOR_LUFS, |v| v[0]);
                ((lb - la) * 10.0).round() / 10.0
            })
            .collect()
    };

    let changed = change.iter().filter(|&&c| c > CHANGED).count();
    let (mut longest, mut run_start, mut loudest) = (0, 0, None);
    for (t, &c) in change.iter().chain([&0.0]).enumerate() {
        if c <= LOUDEST {
            if t - run_start > longest {
                longest = t - run_start;
                loudest = Some((run_start, t));
            }
            run_start = t + 1;
        }
    }
    let (start_ms, end_ms) = loudest.map_or((-1.0, -1.0), |(s, e)| {
        (s as f32 * 1000.0, e as f32 * 1000.0)
    });

    let similarities: Vec<f32> = a
        .chroma
        .chunks_exact(CHROMA_BINS)
        .enumerate()
        .filter_map(|(t, x)| {
            row_at(&b.chroma, CHROMA_BINS, t as f32 + offset_s)
                .map(|y| similarity(x, a.chroma_floor, &y, b.chroma_floor))
        })
        .collect();
    let similarity = if similarities.is_empty() {
        f32::NAN
    } else {
        similarities.iter().sum::<f32>() / similarities.len() as f32
    };

    let share = if change.is_empty() {
        0.0
    } else {
        changed as f32 / change.len() as f32
    };
    Diff {
        summary: [
            changed as f32,
            (share * 100.0).round() / 100.0,
            start_ms,
            end_ms,
            similarity,
        ],
        change,
        loudness_delta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::fingerprint::Quantised;
    use crate::analysis::offline::onsets::FrontEnd;
    use crate::analysis::offline::test_signals::{RATE, midi_hz, noise, tone};

    /// A chord under plucked high notes at irregular times, `seconds` long.
    fn material(seconds: f32) -> Vec<f32> {
        let len = (RATE as f32 * seconds) as usize;
        let mut signal = vec![0.0f32; len];
        for note in [48, 55, 60, 64] {
            for (s, t) in signal.iter_mut().zip(tone(midi_hz(note), 0.08, seconds)) {
                *s += t;
            }
        }
        let pluck: Vec<f32> = tone(midi_hz(88), 0.5, 0.08)
            .iter()
            .enumerate()
            .map(|(i, s)| s * (-(i as f32) / 800.0).exp())
            .collect();
        let mut seed = 12_345u32;
        let mut at = 0usize;
        while at + pluck.len() < len {
            for (s, p) in signal[at..].iter_mut().zip(&pluck) {
                *s += p;
            }
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            at += RATE as usize / 8 + (seed >> 8) as usize % (RATE as usize / 3);
        }
        signal
    }

    fn features_of(signal: &[f32]) -> Features {
        let mut front = FrontEnd::new(RATE, false);
        front.push(signal);
        front.finish();
        let mut features = Features::default();
        let mel: Vec<f32> = front.mel_seconds().iter().flatten().copied().collect();
        let chroma: Vec<f32> = front.chroma_seconds().iter().flatten().copied().collect();
        for (series, values) in [
            (Series::Onset, front.onset()),
            (Series::Mel, &mel),
            (Series::Chroma, &chroma),
        ] {
            let q = Quantised::new(values);
            features
                .set(series, &q.bytes, q.range[0], q.range[1])
                .unwrap();
        }
        features
    }

    #[test]
    fn a_version_shifted_by_two_and_a_half_seconds_aligns_and_reads_unchanged() {
        let a = material(40.0);
        let b: Vec<f32> = vec![0.0; RATE as usize * 5 / 2]
            .into_iter()
            .chain(a.iter().copied())
            .collect();
        let (fa, fb) = (features_of(&a), features_of(&b));

        let offset = align(&fa, &fb).expect("aligned");
        assert!((offset - 2500).abs() <= 20, "{offset}");
        let result = diff(&fa, &fb, offset);
        assert_eq!(result.change.len(), 40);
        assert!(
            result.change.iter().all(|&c| c <= 0.01),
            "{:?}",
            result.change
        );
        assert_eq!(result.summary[0], 0.0);
        assert_eq!(&result.summary[2..4], &[-1.0, -1.0]);
        assert!(result.summary[4] > 0.98, "{:?}", result.summary);
    }

    #[test]
    fn ten_seconds_replaced_by_noise_read_as_changed_there_only() {
        let a = material(40.0);
        let mut replaced = a.clone();
        replaced[RATE as usize * 15..RATE as usize * 25].copy_from_slice(&noise(10.0, 0.5, 4));
        let b: Vec<f32> = vec![0.0; RATE as usize * 5 / 2]
            .into_iter()
            .chain(replaced)
            .collect();
        let (fa, fb) = (features_of(&a), features_of(&b));

        let offset = align(&fa, &fb).expect("aligned");
        assert!((offset - 2500).abs() <= 20, "{offset}");
        let change = diff(&fa, &fb, offset).change;
        for (t, &c) in change.iter().enumerate() {
            match t {
                16..=23 => assert!(c > 0.5, "second {t}: {change:?}"),
                14..=25 => {}
                _ => assert!(c < 0.1, "second {t}: {change:?}"),
            }
        }
    }

    #[test]
    fn silent_seconds_compared_with_silence_read_as_unchanged() {
        let a: Vec<f32> = vec![0.0; RATE as usize * 5]
            .into_iter()
            .chain(material(15.0))
            .collect();
        let (fa, fb) = (features_of(&a), features_of(&a));

        let result = diff(&fa, &fb, 0);
        assert!(
            result.change.iter().all(|&c| c == 0.0),
            "{:?}",
            result.change
        );
        assert_eq!(result.summary[0], 0.0);
        assert_eq!(&result.summary[2..4], &[-1.0, -1.0]);
        assert!(result.summary[4] > 0.98, "{:?}", result.summary);
    }

    #[test]
    fn different_hiss_below_minus_sixty_dbfs_reads_as_unchanged() {
        let with_hiss = |seed| -> Vec<f32> {
            noise(5.0, 0.0003, seed)
                .into_iter()
                .chain(material(15.0))
                .collect()
        };
        let (fa, fb) = (features_of(&with_hiss(1)), features_of(&with_hiss(2)));

        let result = diff(&fa, &fb, 0);
        assert!(
            result.change[..4].iter().all(|&c| c == 0.0),
            "{:?}",
            result.change
        );
        assert!(result.summary[4] > 0.98, "{:?}", result.summary);
    }

    #[test]
    fn silence_against_material_reads_as_wholly_changed() {
        let a = material(10.0);
        let b: Vec<f32> = vec![0.0; RATE as usize * 5]
            .into_iter()
            .chain(a[RATE as usize * 5..].iter().copied())
            .collect();
        let (fa, fb) = (features_of(&a), features_of(&b));

        let result = diff(&fa, &fb, 0);
        assert!(
            result.change[..4].iter().all(|&c| c == 1.0),
            "{:?}",
            result.change
        );
        assert!(
            result.change[6..].iter().all(|&c| c <= 0.01),
            "{:?}",
            result.change
        );
    }

    #[test]
    fn unrelated_material_does_not_align() {
        let fa = features_of(&material(60.0));
        let fb = features_of(&noise(60.0, 0.3, 7));
        assert_eq!(align(&fa, &fb), None);
    }

    #[test]
    fn a_second_without_a_counterpart_is_wholly_changed() {
        let a = material(12.0);
        let (fa, fb) = (features_of(&a), features_of(&a[..RATE as usize * 6]));
        let change = diff(&fa, &fb, 0).change;
        assert!(change[..5].iter().all(|&c| c <= 0.01), "{change:?}");
        assert!(change[7..].iter().all(|&c| c == 1.0), "{change:?}");
    }

    #[test]
    fn a_buffer_that_is_not_whole_rows_is_refused() {
        let mut features = Features::default();
        assert_eq!(
            features.set(Series::Mel, &[0; 41], 0.0, 1.0),
            Err(DspError::BadArgument)
        );
        assert_eq!(
            features.set(Series::Onset, &[0; 4], 1.0, 0.0),
            Err(DspError::BadArgument)
        );
        assert_eq!(Series::from_id(3), Err(DspError::BadArgument));
    }
}
