//! Content-defined chunking: cut a large leaf where its own bytes say to, so
//! a small edit moves only the cuts near it. The parameters and the gear table
//! are part of the storage format; changing either orphans stored chunks.

use std::ops::Range;

/// No chunk is shorter than this, except the last.
pub const MIN: usize = 16 * 1024;
/// No chunk is longer than this.
pub const MAX: usize = 256 * 1024;
/// A cut lands where the top 16 bits of the rolling hash are zero: about
/// 64 KiB past `MIN`.
const MASK: u32 = 0xffff_0000;

/// One random word per byte value: xorshift32 from the golden-ratio seed.
const GEAR: [u32; 256] = gear();

const fn gear() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut x = 0x9e37_79b9u32;
    let mut i = 0;
    while i < 256 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        table[i] = x;
        i += 1;
    }
    table
}

/// The byte ranges `data` is cut into, in order. They partition `data`.
pub fn chunk_ranges(data: &[u8]) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < data.len() {
        let end = next_cut(data, start);
        ranges.push(start..end);
        start = end;
    }
    ranges
}

/// The end of the chunk that begins at `start`.
pub(crate) fn next_cut(data: &[u8], start: usize) -> usize {
    let end = data.len().min(start + MAX);
    if start + MIN >= end {
        return end;
    }
    let mut hash = 0u32;
    for (i, &byte) in data.iter().enumerate().take(end).skip(start + MIN) {
        hash = (hash << 1).wrapping_add(GEAR[byte as usize]);
        if hash & MASK == 0 {
            return i + 1;
        }
    }
    end
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic noise, so a run always sees the same bytes.
    fn noise(len: usize, seed: u32) -> Vec<u8> {
        let mut x = seed;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x >> 24) as u8
            })
            .collect()
    }

    fn pieces<'a>(data: &'a [u8], ranges: &[Range<usize>]) -> Vec<&'a [u8]> {
        ranges.iter().map(|r| &data[r.clone()]).collect()
    }

    #[test]
    fn gear_table_is_the_fixed_xorshift_sequence() {
        let mut x = 0x9e37_79b9u32;
        for &g in GEAR.iter() {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            assert_eq!(g, x);
        }
        assert_eq!(GEAR[0], 1_359_758_873);
    }

    #[test]
    fn boundaries_are_identical_across_runs() {
        let data = noise(2 * 1024 * 1024, 1);
        assert_eq!(chunk_ranges(&data), chunk_ranges(&data));
        assert_eq!(chunk_ranges(&data), chunk_ranges(&data.clone()));
    }

    #[test]
    fn chunks_partition_the_input() {
        let data = noise(1_000_000, 2);
        let ranges = chunk_ranges(&data);
        assert_eq!(ranges.first().map(|r| r.start), Some(0));
        assert_eq!(ranges.last().map(|r| r.end), Some(data.len()));
        assert!(ranges.windows(2).all(|w| w[0].end == w[1].start));
    }

    #[test]
    fn no_chunk_is_under_min_except_the_last_or_over_max() {
        let data = noise(2 * 1024 * 1024, 3);
        let ranges = chunk_ranges(&data);
        assert!(ranges.len() > 4);
        let (last, rest) = ranges.split_last().unwrap();
        assert!(rest.iter().all(|r| r.len() > MIN && r.len() <= MAX));
        assert!(last.len() <= MAX);
    }

    #[test]
    fn a_constant_buffer_is_cut_at_max() {
        let data = vec![0u8; MAX * 2 + 5];
        let lens: Vec<usize> = chunk_ranges(&data).iter().map(|r| r.len()).collect();
        assert_eq!(lens.iter().sum::<usize>(), data.len());
        assert!(lens.iter().all(|&l| l <= MAX));
    }

    #[test]
    fn input_at_or_under_min_is_one_chunk() {
        assert!(chunk_ranges(&[]).is_empty());
        assert_eq!(chunk_ranges(&noise(MIN, 4)), vec![0..MIN]);
        assert_eq!(chunk_ranges(&noise(10, 4)), vec![0..10]);
    }

    #[test]
    fn inserting_near_the_start_changes_only_the_first_few_chunks() {
        let old = noise(2 * 1024 * 1024, 5);
        let mut new = old.clone();
        new.splice(1000..1000, noise(100, 6));

        let old_pieces = pieces(&old, &chunk_ranges(&old));
        let new_ranges = chunk_ranges(&new);
        let new_pieces = pieces(&new, &new_ranges);

        let changed = new_pieces
            .iter()
            .filter(|p| !old_pieces.contains(p))
            .count();
        assert!(old_pieces.len() > 8);
        assert!(
            changed <= 3,
            "{changed} of {} chunks changed",
            new_pieces.len()
        );
    }
}
