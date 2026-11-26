import { errorFields, log } from "./log.js";

/**
 * A byte stream over a generator, pulled as the client reads: a slow client
 * holds the generator where it is rather than buffering the whole file. A
 * generator that throws errors the stream, which ends the connection as a
 * failed download; a cancelled one is closed so its open resources go.
 */
const logger = log("stream");

export function streamOf(
  source: AsyncGenerator<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        logger.error("a download failed after it began", errorFields(error));
        controller.error(error);
      }
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}
