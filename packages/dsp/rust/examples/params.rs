//! Prints `src/params.ts` from the Rust parameter table; `bun run params`
//! writes it.

fn main() {
    print!("{}", projammr_dsp::play::params::typescript());
}
