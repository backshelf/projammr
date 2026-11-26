/**
 * Reads a byte stream in exact amounts, whatever sizes its chunks arrive in.
 * `read(k)` resolves to the next `k` bytes, or to fewer (possibly none) only
 * when the stream ends first. The chunks a read has not consumed are held
 * until the next one, and only the bytes one read asks for are copied out, so
 * a reader never holds more of the stream than one read plus one chunk.
 *
 * An error the stream raises, such as a body limit's, reaches the caller of
 * `read` unchanged.
 */
export function byteReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  /** How far into `pending[0]` the next read starts. */
  let offset = 0;
  /** The bytes held in `pending` past `offset`. */
  let buffered = 0;
  let ended = false;

  async function fill(wanted: number): Promise<void> {
    while (buffered < wanted && !ended) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
      } else if (value.length > 0) {
        pending.push(value);
        buffered += value.length;
      }
    }
  }

  async function read(wanted: number): Promise<Uint8Array> {
    await fill(wanted);

    const out = new Uint8Array(Math.min(wanted, buffered));
    let written = 0;
    while (written < out.length) {
      const head = pending[0]!;
      const take = Math.min(head.length - offset, out.length - written);
      out.set(head.subarray(offset, offset + take), written);
      written += take;
      offset += take;
      if (offset === head.length) {
        pending.shift();
        offset = 0;
      }
    }
    buffered -= out.length;
    return out;
  }

  return { read };
}
