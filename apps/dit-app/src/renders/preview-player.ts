/**
 * The render preview player, ported from the retired scanner's render preview player
 * and its audition constants.
 */

/** What the review rows show about the preview, if anything is loaded. */
export type RenderPreviewState = {
  /** The local path of the file the element holds, null when idle. */
  filePath: string | null;
  playing: boolean;
  currentTime: number;
  /** Seconds, or 0 until the element has read the file's metadata. */
  duration: number;
};

/**
 * The slice of `HTMLAudioElement` the player drives. Naming it keeps the player testable without a DOM, and keeps
 * the element's surface in one place.
 */
export type PreviewAudio = {
  src: string;
  currentTime: number;
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** Resolves a local file to the URL the element plays it from: allows it in the app first. */
export type PreviewSource = (filePath: string) => Promise<string>;

/** How far into a render an audition starts, as a fraction of its length: a render is recognised by its middle. */
export const AUDITION_START = 1 / 3;

/** How far one seek step moves, in seconds. */
export const AUDITION_SEEK_SECONDS = 10;

const IDLE: RenderPreviewState = {
  filePath: null,
  playing: false,
  currentTime: 0,
  duration: 0,
};

/**
 * One `<audio>` element for the whole panel, playing local renders. Sharing the element is what makes "only one
 * preview at a time" a property of the player rather than a rule every card has to remember, and lets a card show
 * elapsed time without owning any transport state of its own.
 */
export class RenderPreviewPlayer {
  private readonly createAudio: () => PreviewAudio;
  private readonly source: PreviewSource;
  private audio: PreviewAudio | null = null;
  private state: RenderPreviewState = IDLE;
  private readonly listeners = new Set<() => void>();
  private pendingFraction: number | null = null;
  /** Counts the loads started, so a slow `source` that a newer play outran drops its answer. */
  private loads = 0;
  /** The file whose source is being resolved, null otherwise. */
  private loading: string | null = null;

  constructor(
    source: PreviewSource,
    createAudio: () => PreviewAudio = () => new Audio()
  ) {
    this.source = source;
    this.createAudio = createAudio;
  }

  /**
   * Subscribing never takes ownership of the element: the cards come and go as renders arrive and settle, and the
   * person who started a preview is still listening. The player's lifetime is the card list's instead, which calls
   * {@link release} when it goes.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RenderPreviewState => this.state;

  /** Plays `filePath` from where it left off, stopping any other preview. Resolves once the element has been told to. */
  async play(filePath: string): Promise<void> {
    const audio = this.element();
    if (this.state.filePath === filePath) {
      this.set({ ...this.state, playing: true });
      // The first play of this file is still waiting on its source, and will start the element when it has it.
      if (this.loading === filePath) return;
    } else {
      audio.pause();
      this.pendingFraction = null;
      this.set({ filePath, playing: true, currentTime: 0, duration: 0 });
      const load = ++this.loads;
      this.loading = filePath;
      let url: string;
      try {
        url = await this.source(filePath);
      } catch {
        if (load === this.loads) {
          this.loading = null;
          this.set({ ...this.state, playing: false });
        }
        return;
      }
      if (load !== this.loads || this.audio !== audio) return;
      this.loading = null;
      audio.src = url;
      audio.load();
      // Paused while the source was resolving: the file is loaded and waits.
      if (!this.state.playing) return;
    }
    void audio.play().catch(() => {
      this.set({ ...this.state, playing: false });
    });
  }

  pause(): void {
    this.audio?.pause();
    this.set({ ...this.state, playing: false });
  }

  toggle(filePath: string): Promise<void> {
    if (this.state.filePath === filePath && this.state.playing) {
      this.pause();
      return Promise.resolve();
    }
    return this.play(filePath);
  }

  seek(seconds: number): void {
    if (!this.audio || this.state.filePath === null) return;
    const clamped = Math.max(
      0,
      this.state.duration > 0 ? Math.min(seconds, this.state.duration) : seconds
    );
    this.audio.currentTime = clamped;
    this.set({ ...this.state, currentTime: clamped });
  }

  /**
   * Plays `filePath` from `fraction` of the way in. The length is unknown until the element has read the file's
   * header, so a fresh file seeks the moment it is.
   */
  playFrom(filePath: string, fraction: number): Promise<void> {
    const fresh = this.state.filePath !== filePath;
    const started = this.play(filePath);
    if (!fresh && this.state.duration > 0) {
      this.seek(this.state.duration * fraction);
    } else {
      this.pendingFraction = fraction;
    }
    return started;
  }

  /** Jumps to `fraction` of the loaded file, once its length is known. */
  seekFraction(fraction: number): void {
    if (this.state.filePath === null) return;
    if (this.state.duration > 0) this.seek(this.state.duration * fraction);
    else this.pendingFraction = fraction;
  }

  seekBy(seconds: number): void {
    this.seek(this.state.currentTime + seconds);
  }

  /** Stops playback and lets go of the element and the file behind it. */
  release(): void {
    this.loads += 1;
    this.loading = null;
    const audio = this.audio;
    if (audio) {
      audio.pause();
      audio.removeEventListener("timeupdate", this.onTimeUpdate);
      audio.removeEventListener("durationchange", this.onDurationChange);
      audio.removeEventListener("ended", this.onEnded);
      audio.removeEventListener("error", this.onError);
      audio.removeAttribute("src");
      audio.load();
      this.audio = null;
    }
    this.pendingFraction = null;
    this.set(IDLE);
  }

  private element(): PreviewAudio {
    if (this.audio) return this.audio;
    const audio = this.createAudio();
    audio.addEventListener("timeupdate", this.onTimeUpdate);
    audio.addEventListener("durationchange", this.onDurationChange);
    audio.addEventListener("ended", this.onEnded);
    audio.addEventListener("error", this.onError);
    this.audio = audio;
    return audio;
  }

  private readonly onTimeUpdate = (): void => {
    if (!this.audio) return;
    this.set({ ...this.state, currentTime: this.audio.currentTime });
  };

  private readonly onDurationChange = (): void => {
    if (!this.audio) return;
    const duration = this.audio.duration;
    this.set({
      ...this.state,
      duration: Number.isFinite(duration) ? duration : 0,
    });
    if (this.pendingFraction !== null && this.state.duration > 0) {
      const fraction = this.pendingFraction;
      this.pendingFraction = null;
      this.seek(this.state.duration * fraction);
    }
  };

  private readonly onEnded = (): void => {
    this.set({ ...this.state, playing: false, currentTime: 0 });
  };

  private readonly onError = (): void => {
    this.set({ ...this.state, playing: false });
  };

  private set(next: RenderPreviewState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
