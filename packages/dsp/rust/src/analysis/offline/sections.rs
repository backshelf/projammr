//! Sections (E4), after J. Foote, "Automatic audio segmentation using a
//! measure of audio novelty", ICME 2000: a novelty curve from a 16 s
//! Gaussian-tapered checkerboard kernel slid along the cosine self-similarity
//! of per-second features, boundaries at its peaks, and segments that repeat
//! grouped under one letter.

use super::dot;
use super::onsets::{CHROMA_BINS, MEL_BANDS};

/// Half the checkerboard, in seconds.
const HALF_KERNEL: usize = 8;
/// The closest two boundaries (or a boundary and either end) may be.
const MIN_SECTION_S: usize = 8;
/// Two groups whose mean features are at least this similar merge.
const JOIN_SIMILARITY: f32 = 0.85;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Section {
    pub start_s: usize,
    /// Exclusive; the last section ends at the last second.
    pub end_s: usize,
    /// Groups number from 0 in order of first appearance ("A", "B", …).
    pub group: u32,
}

fn normalise(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
}

/// One feature per second: the mean log-mel then the chroma, each
/// L2-normalised, so the dot of two is the mean of their cosines (0..1).
fn features(mel: &[[f32; MEL_BANDS]], chroma: &[[f32; CHROMA_BINS]]) -> Vec<Vec<f32>> {
    mel.iter()
        .zip(chroma)
        .map(|(m, c)| {
            let (mut m, mut c) = (m.to_vec(), c.to_vec());
            normalise(&mut m);
            normalise(&mut c);
            m.iter()
                .chain(&c)
                .map(|x| x * std::f32::consts::FRAC_1_SQRT_2)
                .collect()
        })
        .collect()
}

/// The checkerboard novelty at the start of every second: the weighted mean
/// similarity within each side of `t` less the weighted mean across it, over
/// the pairs inside the track, so the ends read no false edge.
fn novelty(features: &[Vec<f32>]) -> Vec<f32> {
    let n = features.len();
    let sigma = HALF_KERNEL as f32 / 2.0;
    let taper = |offset: usize| (-0.5 * ((offset as f32 + 0.5) / sigma).powi(2)).exp();
    (0..n)
        .map(|t| {
            let before: Vec<(usize, f32)> = (1..=HALF_KERNEL.min(t))
                .map(|k| (t - k, taper(k - 1)))
                .collect();
            let after: Vec<(usize, f32)> = (0..HALF_KERNEL.min(n - t))
                .map(|k| (t + k, taper(k)))
                .collect();
            if before.is_empty() || after.is_empty() {
                return 0.0;
            }
            let mean = |xs: &[(usize, f32)], ys: &[(usize, f32)]| {
                let (mut sum, mut weight) = (0.0, 0.0);
                for &(i, wi) in xs {
                    for &(j, wj) in ys {
                        sum += wi * wj * dot(&features[i], &features[j]);
                        weight += wi * wj;
                    }
                }
                sum / weight
            };
            (mean(&before, &before) + mean(&after, &after)) / 2.0 - mean(&before, &after)
        })
        .collect()
}

/// The sections of a track `seconds` long with these per-second means.
pub fn segment(mel: &[[f32; MEL_BANDS]], chroma: &[[f32; CHROMA_BINS]]) -> Vec<Section> {
    let features = features(mel, chroma);
    let n = features.len();
    if n == 0 {
        return Vec::new();
    }

    let curve = novelty(&features);
    let mean = curve.iter().sum::<f32>() / n as f32;
    let deviation = (curve.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n as f32).sqrt();
    let mut peaks: Vec<usize> = (1..n)
        .filter(|&t| {
            curve[t] > mean + deviation
                && curve[t] > 0.0
                && curve[t] >= curve[t - 1]
                && t + 1 < n
                && curve[t] >= curve[t + 1]
        })
        .collect();
    peaks.sort_by(|&a, &b| curve[b].total_cmp(&curve[a]));
    let mut boundaries = vec![0, n];
    for peak in peaks {
        if boundaries
            .iter()
            .all(|&b| peak.abs_diff(b) >= MIN_SECTION_S)
        {
            boundaries.push(peak);
        }
    }
    boundaries.sort_unstable();

    // Each segment's mean feature, then agglomerative grouping by the cosine
    // of the groups' summed features.
    let means: Vec<Vec<f32>> = boundaries
        .windows(2)
        .map(|span| {
            let mut sum = vec![0.0; features[0].len()];
            for feature in &features[span[0]..span[1]] {
                sum.iter_mut().zip(feature).for_each(|(s, f)| *s += f);
            }
            normalise(&mut sum);
            sum
        })
        .collect();
    let mut groups: Vec<(Vec<usize>, Vec<f32>)> = means
        .iter()
        .enumerate()
        .map(|(i, m)| (vec![i], m.clone()))
        .collect();
    loop {
        let mut best = None;
        for a in 0..groups.len() {
            for b in a + 1..groups.len() {
                let (mut x, mut y) = (groups[a].1.clone(), groups[b].1.clone());
                normalise(&mut x);
                normalise(&mut y);
                let similarity = dot(&x, &y);
                if similarity >= JOIN_SIMILARITY && best.is_none_or(|(_, _, s)| similarity > s) {
                    best = Some((a, b, similarity));
                }
            }
        }
        let Some((a, b, _)) = best else { break };
        let (members, sum) = groups.remove(b);
        groups[a].0.extend(members);
        groups[a].1.iter_mut().zip(&sum).for_each(|(s, t)| *s += t);
    }

    let mut letter = vec![u32::MAX; means.len()];
    let mut next = 0;
    for segment in 0..means.len() {
        if letter[segment] == u32::MAX {
            if let Some((members, _)) = groups.iter().find(|(m, _)| m.contains(&segment)) {
                for &member in members {
                    letter[member] = next;
                }
            }
            next += 1;
        }
    }
    boundaries
        .windows(2)
        .zip(letter)
        .map(|(span, group)| Section {
            start_s: span[0],
            end_s: span[1],
            group,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::onsets::FrontEnd;
    use crate::analysis::offline::test_signals::{RATE, midi_hz, noise, tone};

    #[test]
    fn noise_chord_noise_splits_at_twenty_and_forty_seconds_as_a_b_a() {
        let chord: Vec<f32> = [48, 55, 60, 64, 67]
            .map(|note| tone(midi_hz(note), 0.1, 20.0))
            .iter()
            .fold(vec![0.0; RATE as usize * 20], |mut sum, part| {
                sum.iter_mut().zip(part).for_each(|(s, p)| *s += p);
                sum
            });
        let signal: Vec<f32> = noise(20.0, 0.3, 1)
            .into_iter()
            .chain(chord)
            .chain(noise(20.0, 0.3, 2))
            .collect();

        let mut front = FrontEnd::new(RATE, false);
        front.push(&signal);
        front.finish();
        let sections = segment(front.mel_seconds(), front.chroma_seconds());

        assert_eq!(sections.len(), 3, "{sections:?}");
        assert!(sections[0].end_s.abs_diff(20) <= 2, "{sections:?}");
        assert!(sections[1].end_s.abs_diff(40) <= 2, "{sections:?}");
        assert_eq!(sections[2].end_s, 60);
        let groups: Vec<u32> = sections.iter().map(|s| s.group).collect();
        assert_eq!(groups, [0, 1, 0]);
    }

    #[test]
    fn a_steady_signal_is_one_section() {
        let mut front = FrontEnd::new(RATE, false);
        front.push(&noise(30.0, 0.3, 3));
        front.finish();
        let sections = segment(front.mel_seconds(), front.chroma_seconds());
        assert_eq!(
            sections,
            [Section {
                start_s: 0,
                end_s: 30,
                group: 0
            }]
        );
    }
}
