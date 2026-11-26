//! Feature series as stored bytes: every value quantised to a `u8` linearly
//! over the series' own finite range, with the range kept beside the bytes so
//! a later comparison can read the values back. The per-second chroma stored
//! this way is the track's fingerprint.

pub struct Quantised {
    pub bytes: Vec<u8>,
    /// The values byte 0 and byte 255 stand for.
    pub range: [f32; 2],
}

impl Quantised {
    /// A series whose values are all equal (or empty) quantises to zeros over
    /// the range `[value, value]`. A non-finite value reads as the minimum.
    pub fn new(values: &[f32]) -> Self {
        let finite = values.iter().copied().filter(|v| v.is_finite());
        let min = finite.clone().fold(f32::INFINITY, f32::min);
        let max = finite.fold(f32::NEG_INFINITY, f32::max);
        if min > max {
            return Self {
                bytes: vec![0; values.len()],
                range: [0.0; 2],
            };
        }
        let span = max - min;
        let bytes = values
            .iter()
            .map(|&v| {
                if span > 0.0 && v.is_finite() {
                    ((v - min) / span * 255.0).round() as u8
                } else {
                    0
                }
            })
            .collect();
        Self {
            bytes,
            range: [min, max],
        }
    }
}

/// The values `bytes` quantised over `[min, max]`, to within `(max − min) / 510`.
pub fn dequantise(bytes: &[u8], min: f32, max: f32) -> Vec<f32> {
    let step = (max - min) / 255.0;
    bytes.iter().map(|&b| min + f32::from(b) * step).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_series_reads_back_to_within_half_a_step() {
        let values = [-3.0, 0.25, 1.5, 7.0];
        let q = Quantised::new(&values);
        assert_eq!(q.range, [-3.0, 7.0]);
        assert_eq!(q.bytes[0], 0);
        assert_eq!(q.bytes[3], 255);
        for (back, original) in dequantise(&q.bytes, q.range[0], q.range[1])
            .iter()
            .zip(values)
        {
            assert!((back - original).abs() <= 10.0 / 510.0 + 1e-6);
        }
    }

    #[test]
    fn a_flat_or_empty_series_is_zeros() {
        let q = Quantised::new(&[2.0, 2.0]);
        assert_eq!((q.bytes.as_slice(), q.range), (&[0u8, 0][..], [2.0, 2.0]));
        assert!(Quantised::new(&[]).bytes.is_empty());
    }
}
