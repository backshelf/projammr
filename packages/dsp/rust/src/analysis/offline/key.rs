//! Key (E3): the track's mean chroma correlated with the major and minor key
//! profiles of C. L. Krumhansl and E. J. Kessler, "Tracing the dynamic
//! changes in perceived tonal organization", Psychological Review 89, 1982,
//! each rotated through the 12 tonics.

use super::onsets::CHROMA_BINS;

const MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Key {
    /// Pitch class of the tonic, C = 0.
    pub tonic: u8,
    pub minor: bool,
    /// The winner's margin over its best non-relative runner-up, relative to
    /// the winner, 0..1. The runner-up excludes the winner's relative key
    /// (major ↔ its relative minor share every note, so comparing against it
    /// would keep the margin near zero for clearly tonal music).
    pub confidence: f32,
}

fn pearson(x: &[f32; CHROMA_BINS], y: &[f32; CHROMA_BINS]) -> f32 {
    let n = CHROMA_BINS as f32;
    let (mx, my) = (x.iter().sum::<f32>() / n, y.iter().sum::<f32>() / n);
    let (mut xy, mut xx, mut yy) = (0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        let (dx, dy) = (a - mx, b - my);
        xy += dx * dy;
        xx += dx * dx;
        yy += dy * dy;
    }
    let denominator = (xx * yy).sqrt();
    if denominator > 0.0 {
        xy / denominator
    } else {
        0.0
    }
}

/// The best of the 24 keys for `chroma` (power per pitch class over the
/// track), or `None` for a chroma with no variation to correlate.
pub fn estimate(chroma: &[f32; CHROMA_BINS]) -> Option<Key> {
    let mut scores = [[0.0f32; 2]; CHROMA_BINS];
    for tonic in 0..CHROMA_BINS {
        for (minor, profile) in [(false, &MAJOR), (true, &MINOR)] {
            let rotated = std::array::from_fn(|i| profile[(i + CHROMA_BINS - tonic) % CHROMA_BINS]);
            scores[tonic][minor as usize] = pearson(chroma, &rotated);
        }
    }

    let (best_tonic, best_minor) = (0..CHROMA_BINS)
        .flat_map(|tonic| [(tonic, false), (tonic, true)])
        .max_by(|&(at, am), &(bt, bm)| {
            scores[at][am as usize].total_cmp(&scores[bt][bm as usize])
        })?;
    let best = scores[best_tonic][best_minor as usize];

    // The winner's relative key: same notes, other mode, so it is excluded
    // from the runner-up search below.
    let relative_tonic = relative_tonic(best_tonic as u8, best_minor);

    let second = (0..CHROMA_BINS)
        .flat_map(|tonic| [(tonic, false), (tonic, true)])
        .filter(|&(tonic, minor)| {
            !(tonic == best_tonic && minor == best_minor)
                && !(tonic as u8 == relative_tonic && minor != best_minor)
        })
        .map(|(tonic, minor)| scores[tonic][minor as usize])
        .fold(f32::MIN, f32::max);

    (best > 0.0).then(|| Key {
        tonic: best_tonic as u8,
        minor: best_minor,
        confidence: ((best - second) / best).clamp(0.0, 1.0),
    })
}

/// The relative tonic of `(tonic, minor)`: same key signature, other mode.
/// Major `t` → relative minor `(t + 9) % 12`; minor `t` → relative major
/// `(t + 3) % 12`.
fn relative_tonic(tonic: u8, minor: bool) -> u8 {
    if minor {
        (tonic + 3) % 12
    } else {
        (tonic + 9) % 12
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::onsets::FrontEnd;
    use crate::analysis::offline::test_signals::{RATE, midi_hz, tone};

    fn key_of(signal: &[f32]) -> Option<Key> {
        let mut front = FrontEnd::new(RATE, false);
        front.push(signal);
        front.finish();
        estimate(front.chroma_total())
    }

    fn mix(parts: &[Vec<f32>]) -> Vec<f32> {
        let len = parts.iter().map(Vec::len).max().unwrap_or(0);
        (0..len)
            .map(|i| parts.iter().map(|p| p.get(i).copied().unwrap_or(0.0)).sum())
            .collect()
    }

    #[test]
    fn a_c_major_triad_over_a_g_bass_reads_c_major() {
        // G2 bass under C4 E4 G4.
        let notes = [43, 60, 64, 67];
        let signal = mix(&notes.map(|note| tone(midi_hz(note), 0.2, 8.0)));
        let key = key_of(&signal).unwrap();
        assert_eq!((key.tonic, key.minor), (0, false), "{key:?}");
        assert!(key.confidence > 0.0, "{key:?}");
    }

    /// The old formula's margin against the plain runner-up (whatever key
    /// scored second, relative or not): for a chroma exactly matching C
    /// major's own profile, that runner-up is A minor — nearly
    /// indistinguishable from it — so the margin reads only ~0.35 even
    /// though nothing else is remotely as good a fit.
    fn old_confidence(chroma: &[f32; CHROMA_BINS]) -> f32 {
        let mut best = f32::MIN;
        let mut second = f32::MIN;
        for tonic in 0..CHROMA_BINS {
            for profile in [&MAJOR, &MINOR] {
                let rotated =
                    std::array::from_fn(|i| profile[(i + CHROMA_BINS - tonic) % CHROMA_BINS]);
                let r = pearson(chroma, &rotated);
                if r > best {
                    second = best;
                    best = r;
                } else if r > second {
                    second = r;
                }
            }
        }
        ((best - second) / best).clamp(0.0, 1.0)
    }

    #[test]
    fn excluding_the_relative_key_raises_confidence_for_a_textbook_chroma() {
        // A chroma matching the C major profile exactly: `estimate`'s own
        // runner-up search would otherwise land on A minor, C major's
        // relative, which the profiles make nearly as good a fit.
        let chroma = MAJOR;
        let key = estimate(&chroma).unwrap();
        assert_eq!((key.tonic, key.minor), (0, false), "{key:?}");
        assert!(key.confidence > old_confidence(&chroma), "{key:?}");
    }

    #[test]
    fn an_a_minor_arpeggio_reads_a_minor() {
        // A3 C4 E4 A4, a quarter second each, eight times over.
        let notes = [57, 60, 64, 69];
        let signal: Vec<f32> = (0..32)
            .flat_map(|i| tone(midi_hz(notes[i % 4]), 0.4, 0.25))
            .collect();
        let key = key_of(&signal).unwrap();
        assert_eq!((key.tonic, key.minor), (9, true), "{key:?}");
    }

    #[test]
    fn silence_has_no_key() {
        assert_eq!(key_of(&vec![0.0; RATE as usize]), None);
    }
}
