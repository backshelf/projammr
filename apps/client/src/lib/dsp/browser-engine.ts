import {
  createAudioEngine,
  type AudioEngine,
  type AudioEngineEvents,
} from "@/components/music-player/player-engine";
import { createAudioOutput } from "@/lib/dsp/audio-output";
import { createHybridEngine } from "@/lib/dsp/hybrid-engine";
import { requestLabCopy } from "@/lib/dsp/lab-copy";
import { createLabEngine, LabUnavailable } from "@/lib/dsp/lab-engine";
import { isCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";

/**
 * The player's engine in a browser: the hybrid over the audio element and
 * the Lab, both routed (when they are) through one shared output.
 */
export function createBrowserEngine(events: AudioEngineEvents): AudioEngine {
  const output = createAudioOutput();
  return createHybridEngine(events, {
    createPlain: (plainEvents) => createAudioEngine(plainEvents, output),
    async createLab(labEvents) {
      const opened = await output.open();
      if (!opened) throw new LabUnavailable("Audio could not start here");
      return createLabEngine(opened, labEvents, {
        fetch: (input, init) => fetch(input, init),
        coarse: isCoarsePointer,
        requestCopy: requestLabCopy,
      });
    },
    destroy: () => output.close(),
  });
}
