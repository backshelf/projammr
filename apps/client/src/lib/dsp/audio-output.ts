/**
 * The one Web Audio context the player routes through, and the analyser
 * every engine connects into on its way to the speakers: the element
 * engine's graph and the Lab's player share both, so the lava field keeps
 * the same node whichever engine is audible.
 */

export type AudioOutput = { ctx: AudioContext; analyser: AnalyserNode };

/**
 * Moves `param` from its current value (or `from`) to `target` over
 * `seconds`, linearly, so a gain change on the output path never clicks.
 * Pass `from` when a value was scheduled at this same instant: cancelling it
 * leaves `param.value` at whatever the node last computed, not the value just
 * scheduled.
 */
export function rampParam(
  ctx: BaseAudioContext,
  param: AudioParam,
  target: number,
  seconds: number,
  from: number = param.value
) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

export type AudioOutputs = {
  /**
   * The running output, opened on first call. Resolves null wherever a
   * context cannot be created or will not reach `running`; such a context is
   * closed and forgotten, so a later call tries again.
   */
  open: () => Promise<AudioOutput | null>;
  /** The output once opened, for synchronous readers. */
  readonly current: AudioOutput | null;
  close: () => void;
};

/** A context of whatever name this browser gives the constructor, or null. */
function openAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    return new Ctx();
  } catch {
    return null;
  }
}

async function running(ctx: AudioContext): Promise<boolean> {
  try {
    await ctx.resume();
  } catch {
    // the state check is the answer either way
  }
  return ctx.state === "running";
}

export function createAudioOutput(): AudioOutputs {
  let current: AudioOutput | null = null;
  let opening: Promise<AudioOutput | null> | null = null;

  async function open(): Promise<AudioOutput | null> {
    if (current) return (await running(current.ctx)) ? current : null;
    const ctx = openAudioContext();
    if (!ctx) return null;
    if (!(await running(ctx))) {
      void ctx.close().catch(() => {});
      return null;
    }
    try {
      const analyser = ctx.createAnalyser(); // the lava field sets its own FFT size, range and smoothing
      analyser.connect(ctx.destination);
      current = { ctx, analyser };
      return current;
    } catch {
      void ctx.close().catch(() => {});
      return null;
    }
  }

  return {
    open() {
      opening ??= open().finally(() => {
        opening = null;
      });
      return opening;
    },
    get current() {
      return current;
    },
    close() {
      if (current) void current.ctx.close().catch(() => {});
      current = null;
    },
  };
}
