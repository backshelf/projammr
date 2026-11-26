/** Milliseconds as a playback timecode: 92000 becomes "1:32". */
export const formatTimecode = (ms: number) => formatClock(ms / 1000);

/** Seconds as a playback timecode: 92 becomes "1:32". */
export const formatSeconds = (seconds: number) => formatClock(seconds);

const formatClock = (rawSeconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(rawSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};
