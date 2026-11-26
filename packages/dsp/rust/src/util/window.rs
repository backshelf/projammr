//! Analysis and synthesis windows.
//!
//! Both are periodic (the denominator is `n`, not `n − 1`), which is what makes
//! overlapping frames add up to a constant.

use std::f64::consts::PI;

fn periodic_hann(i: usize, n: usize) -> f64 {
    0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()
}

/// The periodic Hann window, `0.5 − 0.5·cos(2πi/n)`. Frames spaced `n / 2` or
/// `n / 4` apart overlap-add to 1 or 2.
pub fn hann(n: usize) -> Vec<f32> {
    (0..n).map(|i| periodic_hann(i, n) as f32).collect()
}

/// The square root of [`hann`], for windowing both analysis and resynthesis:
/// the two applications multiply to a Hann window.
pub fn sqrt_hann(n: usize) -> Vec<f32> {
    (0..n).map(|i| periodic_hann(i, n).sqrt() as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlap_add(window: &[f32], hop: usize) -> Vec<f32> {
        let n = window.len();
        (0..n)
            .map(|i| (0..n / hop).map(|k| window[(i + k * hop) % n]).sum())
            .collect()
    }

    #[test]
    fn hann_is_periodic() {
        let n = 16;
        let w = hann(n);
        assert_eq!(w.len(), n);
        assert_eq!(w[0], 0.0);
        assert_eq!(w[n / 2], 1.0);
        for i in 1..n {
            assert!((w[i] - w[n - i]).abs() < 1e-7, "w[{i}] != w[{}]", n - i);
        }
    }

    #[test]
    fn hann_sums_to_half_its_length() {
        let sum: f64 = hann(8192).iter().map(|&v| f64::from(v)).sum();
        assert!((sum - 4096.0).abs() < 1e-3, "sum {sum}");
    }

    #[test]
    fn hann_overlap_adds_to_a_constant_at_half_and_quarter_hops() {
        let w = hann(2048);
        for v in overlap_add(&w, 1024) {
            assert!((v - 1.0).abs() < 1e-5, "{v}");
        }
        for v in overlap_add(&w, 512) {
            assert!((v - 2.0).abs() < 1e-5, "{v}");
        }
    }

    #[test]
    fn sqrt_hann_squared_is_hann() {
        let n = 2048;
        for (s, h) in sqrt_hann(n).iter().zip(hann(n)) {
            assert!((s * s - h).abs() < 1e-6);
        }
    }

    #[test]
    fn an_empty_window_has_no_samples() {
        assert!(hann(0).is_empty());
        assert!(sqrt_hann(0).is_empty());
    }
}
