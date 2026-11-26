/** Kindling, a track from the demo catalogue (`packages/demo`), as the app
 * would show it: two bounces of the same song, each with what the server
 * measured and the comments pinned to it.
 *
 * The figures are the server's own. Each bounce was run through
 * `decodeInto` (`apps/server/src/lib/media.ts`) and `AnalysisSession`
 * (`packages/dsp/src/analysis.ts`), the pieces `analyseTrackAudio` runs on an
 * upload; `lufs`, `lra` and `truePeakDb` are what it stores, at the precision
 * the columns keep. The server stores one peak per 50 ms; `bars` is that array
 * reduced to the waveform's 160 bars by `toBars` (`@workspace/ui/lib/
 * waveform-bars`) against a ceiling of 1, so drawing it at 160 bars gives the
 * same bars the app draws from the full array. The audio is not in the repo.
 *
 * The pins are the catalogue's own comments, by its invented people. */

type Pin = { author: string; positionMs: number; text: string };

export type KindlingVersion = {
  version: number;
  /** The bounce's file name, which the app lists a version by. */
  name: string;
  lufs: number;
  lra: number;
  truePeakDb: number;
  bars: number[];
  pins: Pin[];
};

export const KINDLING = {
  title: "Kindling",
  collection: "Harbour Lights",
  durationMs: 180428,
  mix: {
    version: 1,
    name: "kindling - mix 1.mp3",
    lufs: -16.3,
    lra: 6.2,
    truePeakDb: -1.8,
    // prettier-ignore
    bars: [0.121,0.12,0.093,0.092,0.194,0.166,0.15,0.129,0.13,0.142,0.161,0.133,0.137,0.233,0.267,0.256,0.242,0.245,0.245,0.23,0.261,0.223,0.254,0.272,0.247,0.224,0.29,0.34,0.271,0.223,0.381,0.508,0.383,0.574,0.375,0.572,0.276,0.454,0.513,0.559,0.521,0.401,0.473,0.364,0.51,0.453,0.528,0.546,0.434,0.544,0.449,0.507,0.425,0.507,0.43,0.498,0.539,0.416,0.551,0.484,0.552,0.442,0.556,0.465,0.6,0.57,0.478,0.52,0.55,0.568,0.436,0.626,0.463,0.48,0.517,0.58,0.464,0.432,0.521,0.443,0.556,0.525,0.6,0.592,0.503,0.373,0.503,0.363,0.394,0.55,0.565,0.622,0.581,0.576,0.492,0.479,0.492,0.579,0.509,0.425,0.594,0.552,0.653,0.548,0.48,0.49,0.589,0.521,0.683,0.502,0.545,0.634,0.546,0.507,0.433,0.579,0.58,0.64,0.549,0.476,0.573,0.446,0.487,0.417,0.637,0.632,0.648,0.66,0.534,0.554,0.554,0.672,0.467,0.628,0.579,0.62,0.701,0.608,0.638,0.468,0.613,0.529,0.688,0.528,0.683,0.634,0.592,0.509,0.657,0.646,0.511,0.664,0.56,0.704,0.563,0.565,0.08,0.046,0.026,0.006],
    pins: [
      {
        author: "Tomás Ferreira",
        positionMs: 31000,
        text: "Kick and bass are fighting here. I'll carve the low end on the next pass.",
      },
      {
        author: "Juno Adeyemi",
        positionMs: 142000,
        text: "Vocal disappears under the synth in this chorus.",
      },
    ],
  },
  final: {
    version: 2,
    name: "kindling - final.mp3",
    lufs: -12.8,
    lra: 6.4,
    truePeakDb: 0.1,
    // prettier-ignore
    bars: [0.148,0.145,0.122,0.135,0.226,0.232,0.214,0.183,0.167,0.196,0.214,0.187,0.184,0.332,0.371,0.389,0.366,0.374,0.319,0.329,0.367,0.294,0.35,0.383,0.339,0.308,0.454,0.468,0.402,0.342,0.513,0.679,0.575,0.783,0.653,0.741,0.515,0.641,0.717,0.924,0.69,0.52,0.664,0.545,0.757,0.602,0.808,0.805,0.633,0.713,0.687,0.635,0.753,0.802,0.676,0.801,0.821,0.643,0.79,0.844,0.76,0.674,0.833,0.792,0.876,0.884,0.75,0.776,0.679,0.773,0.693,0.807,0.73,0.715,0.84,0.772,0.691,0.643,0.792,0.674,0.717,0.79,0.884,0.848,0.78,0.582,0.678,0.578,0.618,0.865,0.808,0.866,0.826,0.799,0.715,0.685,0.646,0.738,0.672,0.735,0.914,0.802,0.864,0.819,0.656,0.779,0.747,0.745,0.775,0.691,0.769,0.791,0.704,0.79,0.63,0.755,0.878,0.774,0.805,0.689,0.774,0.627,0.66,0.674,0.865,0.898,0.874,0.88,0.791,0.722,0.821,0.916,0.635,0.841,0.945,0.913,0.868,0.804,0.895,0.711,0.789,0.692,0.894,0.672,0.918,0.911,0.768,0.706,0.86,0.767,0.802,0.892,0.787,0.812,0.793,0.749,0.148,0.088,0.048,0.011],
    pins: [
      {
        author: "Juno Adeyemi",
        positionMs: 142000,
        text: "Much better, I can hear every word now.",
      },
    ],
  },
} satisfies {
  title: string;
  collection: string;
  durationMs: number;
  mix: KindlingVersion;
  final: KindlingVersion;
};
