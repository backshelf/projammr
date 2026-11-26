//! The chain's blocks, parameters and meters: the one table both sides of the
//! ABI read. `packages/dsp/src/params.ts` is generated from it by
//! `bun run params`, and a test here fails when the committed file differs.
//!
//! Every parameter is one `f32` addressed by its [`ParamId`]. A parameter's
//! [`Domain`] says which values `chain_set` accepts: a range, a toggle (0 or
//! 1), or the index of one of a [`Choices`] list.

use std::fmt::Write;

use super::bands::Band;
use super::biquad::FilterKind;
use super::device::Device;
use super::pitch::TimeMode;
use super::reverb::Preset;
use super::stereo::StereoMode;

/// The names of an enum whose variants a parameter value selects by index.
#[derive(Debug)]
pub struct Choices {
    pub name: &'static str,
    pub names: &'static [&'static str],
}

/// Declares an enum a parameter selects, with its [`Choices`] and a
/// `from_value` that reads a validated parameter value.
macro_rules! choices {
    (
        $(#[$meta:meta])*
        pub enum $name:ident { $($(#[$variant_meta:meta])* $variant:ident),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name { $($(#[$variant_meta])* $variant),+ }

        impl $name {
            const ALL: &[$name] = &[$($name::$variant),+];

            pub const CHOICES: $crate::play::params::Choices = $crate::play::params::Choices {
                name: stringify!($name),
                names: &[$(stringify!($variant)),+],
            };

            /// The variant a parameter value names. `chain_set` only passes
            /// indices it has checked, so anything else reads as the last.
            pub fn from_value(value: f32) -> Self {
                Self::ALL[(value as usize).min(Self::ALL.len() - 1)]
            }
        }
    };
}
pub(crate) use choices;

/// The values a parameter accepts.
#[derive(Clone, Copy, Debug)]
pub enum Domain {
    Range {
        min: f32,
        max: f32,
        default: f32,
    },
    Toggle {
        default: bool,
    },
    Choice {
        choices: &'static Choices,
        default: usize,
    },
}

impl Domain {
    /// `value` when the domain accepts it.
    pub fn accept(&self, value: f32) -> Option<f32> {
        let accepted = match *self {
            Domain::Range { min, max, .. } => (min..=max).contains(&value),
            Domain::Toggle { .. } => value == 0.0 || value == 1.0,
            Domain::Choice { choices, .. } => {
                value.fract() == 0.0 && value >= 0.0 && (value as usize) < choices.names.len()
            }
        };
        accepted.then_some(value)
    }

    pub fn default_value(&self) -> f32 {
        match *self {
            Domain::Range { default, .. } => default,
            Domain::Toggle { default } => f32::from(u8::from(default)),
            Domain::Choice { default, .. } => default as f32,
        }
    }
}

const fn range(min: f32, max: f32, default: f32) -> Domain {
    Domain::Range { min, max, default }
}

const fn toggle(default: bool) -> Domain {
    Domain::Toggle { default }
}

const fn choice(choices: &'static Choices, default: usize) -> Domain {
    Domain::Choice { choices, default }
}

macro_rules! blocks {
    ($($(#[$meta:meta])* $name:ident: bypassed = $bypassed:literal;)+) => {
        /// The chain's blocks, in processing order.
        #[repr(u32)]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum BlockId { $($(#[$meta])* $name),+ }

        impl BlockId {
            pub const ALL: &[BlockId] = &[$(BlockId::$name),+];
            const NAMES: &[&str] = &[$(stringify!($name)),+];
            const BYPASSED: &[bool] = &[$($bypassed),+];

            pub fn from_id(id: u32) -> Option<BlockId> {
                Self::ALL.get(id as usize).copied()
            }

            /// Whether a new chain starts with the block bypassed: every block
            /// whose defaults change the sound does.
            pub fn bypassed_by_default(self) -> bool {
                Self::BYPASSED[self as usize]
            }
        }
    };
}

blocks! {
    TimePitch: bypassed = false;
    BandSolo: bypassed = true;
    Eq: bypassed = true;
    Compressor: bypassed = true;
    Reverb: bypassed = true;
    Stereo: bypassed = false;
    Crossfeed: bypassed = true;
    Device: bypassed = true;
    Gain: bypassed = false;
}

/// One parameter: its name, the block it belongs to and its domain.
#[derive(Debug)]
pub struct ParamSpec {
    pub name: &'static str,
    pub block: BlockId,
    pub domain: Domain,
}

macro_rules! params {
    ($($(#[$meta:meta])* $name:ident: $block:ident = $domain:expr;)+) => {
        #[repr(u32)]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum ParamId { $($(#[$meta])* $name),+ }

        impl ParamId {
            pub const ALL: &[ParamId] = &[$(ParamId::$name),+];

            pub fn from_id(id: u32) -> Option<ParamId> {
                Self::ALL.get(id as usize).copied()
            }

            pub fn spec(self) -> &'static ParamSpec {
                &PARAMS[self as usize]
            }
        }

        pub const PARAMS: &[ParamSpec] = &[$(ParamSpec {
            name: stringify!($name),
            block: BlockId::$block,
            domain: $domain,
        }),+];
    };
}

params! {
    TimeMode: TimePitch = choice(&TimeMode::CHOICES, TimeMode::Speed as usize);
    /// Playback speed: 0.5 is half speed.
    TimeSpeed: TimePitch = range(0.5, 2.0, 1.0);
    TimePitchSemitones: TimePitch = range(-12.0, 12.0, 0.0);

    BandLowSolo: BandSolo = toggle(false);
    BandLowMidSolo: BandSolo = toggle(false);
    BandMidSolo: BandSolo = toggle(false);
    BandHighMidSolo: BandSolo = toggle(false);
    BandAirSolo: BandSolo = toggle(false);
    BandSplit1Hz: BandSolo = range(40.0, 250.0, 120.0);
    BandSplit2Hz: BandSolo = range(250.0, 1200.0, 500.0);
    BandSplit3Hz: BandSolo = range(1200.0, 5000.0, 2500.0);
    BandSplit4Hz: BandSolo = range(5000.0, 16000.0, 8000.0);

    Eq1Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Off as usize);
    Eq1Hz: Eq = range(20.0, 20000.0, 20.0);
    Eq1GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq1Q: Eq = range(0.1, 10.0, 0.9);
    Eq2Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq2Hz: Eq = range(20.0, 20000.0, 60.0);
    Eq2GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq2Q: Eq = range(0.1, 10.0, 0.9);
    Eq3Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq3Hz: Eq = range(20.0, 20000.0, 150.0);
    Eq3GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq3Q: Eq = range(0.1, 10.0, 0.9);
    Eq4Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq4Hz: Eq = range(20.0, 20000.0, 400.0);
    Eq4GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq4Q: Eq = range(0.1, 10.0, 0.9);
    Eq5Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq5Hz: Eq = range(20.0, 20000.0, 1000.0);
    Eq5GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq5Q: Eq = range(0.1, 10.0, 0.9);
    Eq6Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq6Hz: Eq = range(20.0, 20000.0, 2500.0);
    Eq6GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq6Q: Eq = range(0.1, 10.0, 0.9);
    Eq7Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::Peaking as usize);
    Eq7Hz: Eq = range(20.0, 20000.0, 6000.0);
    Eq7GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq7Q: Eq = range(0.1, 10.0, 0.9);
    Eq8Kind: Eq = choice(&FilterKind::CHOICES, FilterKind::HighShelf as usize);
    Eq8Hz: Eq = range(20.0, 20000.0, 12000.0);
    Eq8GainDb: Eq = range(-18.0, 18.0, 0.0);
    Eq8Q: Eq = range(0.1, 10.0, 0.9);

    CompThresholdDb: Compressor = range(-60.0, 0.0, -18.0);
    CompRatio: Compressor = range(1.0, 20.0, 3.0);
    CompKneeDb: Compressor = range(0.0, 24.0, 6.0);
    CompAttackMs: Compressor = range(0.1, 200.0, 10.0);
    CompReleaseMs: Compressor = range(5.0, 2000.0, 120.0);
    CompMakeupDb: Compressor = range(0.0, 24.0, 0.0);

    ReverbPreset: Reverb = choice(&Preset::CHOICES, Preset::Room as usize);
    ReverbWet: Reverb = range(0.0, 1.0, 0.25);
    ReverbPreDelayMs: Reverb = range(0.0, 100.0, 15.0);

    StereoMode: Stereo = choice(&StereoMode::CHOICES, StereoMode::Stereo as usize);
    StereoWidth: Stereo = range(0.0, 2.0, 1.0);
    StereoInvertRight: Stereo = toggle(false);

    Device: Device = choice(&Device::CHOICES, Device::Phone as usize);

    GainDim: Gain = toggle(false);
    GainTrimDb: Gain = range(-12.0, 12.0, 0.0);
    GainNormaliseDb: Gain = range(-30.0, 30.0, 0.0);
}

macro_rules! meters {
    ($($name:ident,)+) => {
        /// What `chain_meter` reads.
        #[repr(u32)]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum MeterId { $($name),+ }

        impl MeterId {
            pub const ALL: &[MeterId] = &[$(MeterId::$name),+];
            const NAMES: &[&str] = &[$(stringify!($name)),+];

            pub fn from_id(id: u32) -> Option<MeterId> {
                Self::ALL.get(id as usize).copied()
            }
        }
    };
}

meters! {
    GainReductionDb,
    Correlation,
}

/// The EQ's parametric parameters come four to a band in this order.
pub const EQ_BAND_FIELDS: usize = 4;

/// The band solo toggles, in [`Band`] order.
pub const BAND_SOLOS: [ParamId; Band::COUNT] = [
    ParamId::BandLowSolo,
    ParamId::BandLowMidSolo,
    ParamId::BandMidSolo,
    ParamId::BandHighMidSolo,
    ParamId::BandAirSolo,
];

/// `packages/dsp/src/params.ts`, as `bun run params` writes it.
pub fn typescript() -> String {
    let mut out = String::new();
    let mut line = |text: &str| {
        out.push_str(text);
        out.push('\n');
    };
    line("// Generated from rust/src/play/params.rs by `bun run params`; do not edit.");
    line("// `cargo test` fails when this file and the Rust table disagree.");
    line("");
    line("/** The chain's blocks, in processing order. */");
    enum_object(&mut line, "Block", BlockId::NAMES);
    line("export type BlockId = (typeof Block)[keyof typeof Block];");
    line("");
    line("/** Whether a new chain starts with each block bypassed, by block id. */");
    line("export const BLOCK_BYPASSED: readonly boolean[] = [");
    for bypassed in BlockId::BYPASSED {
        line(&format!("  {bypassed},"));
    }
    line("];");
    line("");

    let mut seen: Vec<&str> = Vec::new();
    for spec in PARAMS {
        if let Domain::Choice { choices, .. } = spec.domain
            && !seen.contains(&choices.name)
        {
            seen.push(choices.name);
            enum_object(&mut line, choices.name, choices.names);
            line("");
        }
    }

    enum_object(
        &mut line,
        "Param",
        &PARAMS.iter().map(|p| p.name).collect::<Vec<_>>(),
    );
    line("export type ParamId = (typeof Param)[keyof typeof Param];");
    line("");
    line("export type ParamDomain =");
    line("  | { kind: \"range\"; min: number; max: number; default: number }");
    line("  | { kind: \"toggle\"; default: boolean }");
    line("  | { kind: \"choice\"; choices: Record<string, number>; default: number };");
    line("");
    line("export type ParamSpec = ParamDomain & { name: string; block: BlockId };");
    line("");
    line("/** Every parameter's block and domain, by parameter id. */");
    line("export const PARAMS: readonly ParamSpec[] = [");
    for spec in PARAMS {
        line("  {");
        line(&format!("    name: \"{}\",", spec.name));
        line(&format!(
            "    block: Block.{},",
            BlockId::NAMES[spec.block as usize]
        ));
        match spec.domain {
            Domain::Range { min, max, default } => {
                line("    kind: \"range\",");
                line(&format!("    min: {min},"));
                line(&format!("    max: {max},"));
                line(&format!("    default: {default},"));
            }
            Domain::Toggle { default } => {
                line("    kind: \"toggle\",");
                line(&format!("    default: {default},"));
            }
            Domain::Choice { choices, default } => {
                line("    kind: \"choice\",");
                line(&format!("    choices: {},", choices.name));
                line(&format!(
                    "    default: {}.{},",
                    choices.name, choices.names[default]
                ));
            }
        }
        line("  },");
    }
    line("];");
    line("");
    line("/** What `Chain.meter` reads. */");
    enum_object(&mut line, "Meter", MeterId::NAMES);
    line("export type MeterId = (typeof Meter)[keyof typeof Meter];");
    out
}

fn enum_object(line: &mut impl FnMut(&str), name: &str, names: &[&str]) {
    let mut text = format!("export const {name} = {{\n");
    for (index, variant) in names.iter().enumerate() {
        let _ = writeln!(text, "  {variant}: {index},");
    }
    text.push_str("} as const;");
    line(&text);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_default_is_inside_its_domain() {
        for spec in PARAMS {
            let default = spec.domain.default_value();
            assert_eq!(spec.domain.accept(default), Some(default), "{}", spec.name);
        }
    }

    #[test]
    fn ids_round_trip_and_stop_at_the_table_end() {
        for (index, param) in ParamId::ALL.iter().enumerate() {
            assert_eq!(ParamId::from_id(index as u32), Some(*param));
            assert_eq!(param.spec().name, PARAMS[index].name);
        }
        assert_eq!(ParamId::from_id(PARAMS.len() as u32), None);
        assert_eq!(BlockId::from_id(BlockId::ALL.len() as u32), None);
        assert_eq!(MeterId::from_id(MeterId::ALL.len() as u32), None);
    }

    #[test]
    fn domains_refuse_values_outside_them() {
        let range = range(-1.0, 1.0, 0.0);
        assert_eq!(range.accept(1.0), Some(1.0));
        assert_eq!(range.accept(1.5), None);
        assert_eq!(range.accept(f32::NAN), None);
        assert_eq!(toggle(false).accept(0.5), None);
        assert_eq!(toggle(false).accept(1.0), Some(1.0));
        let modes = choice(&TimeMode::CHOICES, 0);
        assert_eq!(modes.accept(3.0), Some(3.0));
        assert_eq!(modes.accept(4.0), None);
        assert_eq!(modes.accept(1.5), None);
        assert_eq!(modes.accept(-1.0), None);
    }

    #[test]
    fn eq_parameters_come_four_to_a_band() {
        let first = ParamId::Eq1Kind as usize;
        for band in 0..8 {
            let names = ["Kind", "Hz", "GainDb", "Q"];
            for (field, suffix) in names.iter().enumerate() {
                let spec = &PARAMS[first + band * EQ_BAND_FIELDS + field];
                assert_eq!(spec.name, format!("Eq{}{suffix}", band + 1));
            }
        }
    }

    #[test]
    fn the_committed_params_ts_matches_the_table() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/params.ts");
        let committed = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            committed == typescript(),
            "src/params.ts is stale: run `bun run params` in packages/dsp"
        );
    }
}
