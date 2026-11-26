//! The bar's progress arc: the icon while a push is going, drawn here as a few template images (black, with the shape
//! in the alpha, so macOS tints them like the dit icon in light and dark menu bars). The arc is a ring with a dim
//! track and a bright stretch that grows clockwise from the top as the push's repos finish.

use std::f32::consts::TAU;

/// How many arc images there are: the stretch of the ring that is lit grows in these steps, up to the whole ring.
pub const STEPS: usize = 8;

/// The side of an image, in pixels: the bar icon at twice its point size, as the dit icon is.
pub const SIZE: usize = 32;

/// Where the ring's stroke lies, in pixels from the centre.
const INNER: f32 = 8.4;
const OUTER: f32 = 11.6;

/// How much of the ring's alpha the unlit track keeps.
const TRACK: f32 = 0.3;

/// Samples per pixel along each axis, for smooth edges.
const SAMPLES: usize = 4;

/// Which of the `STEPS` images (1 to `STEPS`) shows `done` of `total` repos pushed. The repo being pushed counts as
/// half done, so a push of one repo shows half a ring rather than an empty one, and the ring is never empty while
/// pushing.
pub fn step(done: usize, total: usize) -> usize {
    if total == 0 {
        return 1;
    }
    let fraction = (done as f32 + 0.5) / total as f32;
    ((fraction * STEPS as f32).round() as usize).clamp(1, STEPS)
}

/// The RGBA pixels of image `step` (1 to `STEPS`, clamped), `SIZE` by `SIZE`, rows from the top. Every pixel is black:
/// only the alpha carries the shape.
pub fn frame(step: usize) -> Vec<u8> {
    let lit = step.clamp(1, STEPS) as f32 / STEPS as f32;
    let centre = SIZE as f32 / 2.0;
    let mut pixels = vec![0u8; SIZE * SIZE * 4];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut covered = 0.0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let px = x as f32 + (sx as f32 + 0.5) / SAMPLES as f32 - centre;
                    let py = y as f32 + (sy as f32 + 0.5) / SAMPLES as f32 - centre;
                    let radius = px.hypot(py);
                    if !(INNER..=OUTER).contains(&radius) {
                        continue;
                    }
                    // Clockwise from twelve o'clock, as a fraction of a turn.
                    let turn = px.atan2(-py).rem_euclid(TAU) / TAU;
                    covered += if turn < lit { 1.0 } else { TRACK };
                }
            }
            let alpha = covered / (SAMPLES * SAMPLES) as f32;
            pixels[(y * SIZE + x) * 4 + 3] = (alpha * 255.0).round() as u8;
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The total alpha of an image: how much ink it has.
    fn ink(step: usize) -> u32 {
        frame(step).chunks(4).map(|pixel| u32::from(pixel[3])).sum()
    }

    #[test]
    fn a_push_of_one_repo_shows_half_a_ring_and_a_longer_burst_walks_round() {
        assert_eq!(step(0, 1), 4);
        assert_eq!(
            (0..4).map(|done| step(done, 4)).collect::<Vec<_>>(),
            [1, 3, 5, 7]
        );
        let walk: Vec<usize> = (0..10).map(|done| step(done, 10)).collect();
        assert!(walk.windows(2).all(|pair| pair[0] <= pair[1]), "{walk:?}");
        assert_eq!(walk.first(), Some(&1));
        assert_eq!(walk.last(), Some(&8));
    }

    #[test]
    fn the_step_stays_within_the_images_whatever_the_counts() {
        assert_eq!(step(0, 0), 1);
        assert_eq!(step(5, 0), 1);
        assert_eq!(step(3, 3), STEPS);
        assert_eq!(step(9, 3), STEPS);
        assert_eq!(step(0, 1_000_000), 1);
    }

    #[test]
    fn a_frame_is_a_full_image_of_black_pixels_whose_alpha_is_the_shape() {
        for at in 1..=STEPS {
            let pixels = frame(at);
            assert_eq!(pixels.len(), SIZE * SIZE * 4);
            assert!(
                pixels.chunks(4).all(|pixel| pixel[..3] == [0, 0, 0]),
                "step {at} is not template black"
            );
            assert!(
                pixels.chunks(4).any(|pixel| pixel[3] > 0),
                "step {at} is empty"
            );
            assert!(
                pixels.chunks(4).any(|pixel| pixel[3] == 0),
                "step {at} is a filled square"
            );
        }
    }

    #[test]
    fn the_ring_is_centred_with_its_middle_clear() {
        let pixels = frame(STEPS);
        let alpha = |x: usize, y: usize| pixels[(y * SIZE + x) * 4 + 3];
        assert_eq!(alpha(SIZE / 2, SIZE / 2), 0);
        assert_eq!(alpha(0, 0), 0);
        // A whole ring is lit all the way round: the top, the right, the bottom and the left of the stroke.
        for (x, y) in [(16, 5), (26, 16), (16, 26), (5, 16)] {
            assert_eq!(alpha(x, y), 255, "({x}, {y})");
        }
    }

    #[test]
    fn each_step_lights_more_of_the_ring_and_the_unlit_part_stays_as_a_track() {
        let inks: Vec<u32> = (1..=STEPS).map(ink).collect();
        assert!(inks.windows(2).all(|pair| pair[0] < pair[1]), "{inks:?}");
        // Step 2 of 8 lights the first quarter, from the top to the right: the top of the stroke is lit and the left
        // is a track at its dim alpha.
        let pixels = frame(2);
        let alpha = |x: usize, y: usize| pixels[(y * SIZE + x) * 4 + 3];
        assert_eq!(alpha(17, 5), 255);
        assert!(alpha(5, 16).abs_diff((TRACK * 255.0) as u8) <= 1);
    }
}
