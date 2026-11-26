export type Neighbour = { id: number; title: string };
export type RunningOrder = {
  /** 1-based position, or null when the track is not in the list. */
  position: number | null;
  total: number;
  previous: Neighbour | null;
  next: Neighbour | null;
};

/** Where a track sits in a collection's ordered listing and who its
 *  neighbours are. The listing is already in track-number order. */
export function runningOrder(
  siblings: Neighbour[],
  trackId: number
): RunningOrder {
  const index = siblings.findIndex((t) => t.id === trackId);
  if (index < 0)
    return {
      position: null,
      total: siblings.length,
      previous: null,
      next: null,
    };
  return {
    position: index + 1,
    total: siblings.length,
    previous: siblings[index - 1] ?? null,
    next: siblings[index + 1] ?? null,
  };
}
