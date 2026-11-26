/**
 * Pairs each item with a React key taken from its content, for lists whose
 * items carry no id and may repeat a value (error strings, device names,
 * waveform bar heights). A repeat is numbered by how many equal keys came
 * before it, so every key is unique and stays put for as long as the content
 * before it does.
 */
export function keyedByContent<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const repeats = seen.get(base) ?? 0;
    seen.set(base, repeats + 1);
    return { key: repeats === 0 ? base : `${base}#${repeats}`, item };
  });
}
