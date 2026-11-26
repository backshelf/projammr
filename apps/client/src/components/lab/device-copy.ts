import type { DeviceKey } from "@/lib/dsp/lab-settings";

/** What each device pill's tooltip says it does to the sound — the honesty
 *  line the core plan asks for, spelled out per device. */
export const DEVICE_DESCRIPTIONS: Record<DeviceKey, string> = {
  phone: "Small speaker, no lows, a peak around 2.5 kHz",
  laptop: "Thin body, rolled-off bass, boosted upper mids",
  earbuds: "Tight low end, forward highs, no room to fight the mix in",
  car: "Road and engine noise bury anything quiet",
  club: "A system tuned to be felt as much as heard, huge low end",
  radio: "Heavily compressed and narrowed to a telephone-like band",
};

export const DEVICE_LABEL: Record<DeviceKey, string> = {
  phone: "a phone speaker",
  laptop: "a laptop speaker",
  earbuds: "earbuds",
  car: "a car stereo",
  club: "a club system",
  radio: "the radio",
};
