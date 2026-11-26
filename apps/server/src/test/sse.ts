/**
 * Reads server-sent events off a response body one at a time, failing when
 * none arrives before the deadline instead of waiting on an open stream.
 */
export function sseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(
      timeoutMs = 2000
    ): Promise<{ event?: string; data: string; id?: string }> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const fields = new Map<string, string>();
          for (const line of buffer.slice(0, end).split("\n")) {
            const colon = line.indexOf(": ");
            fields.set(line.slice(0, colon), line.slice(colon + 2));
          }
          buffer = buffer.slice(end + 2);
          return {
            event: fields.get("event"),
            data: fields.get("data") ?? "",
            id: fields.get("id"),
          };
        }

        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(Math.max(0, deadline - Date.now())).then(() => null),
        ]);
        if (!chunk) throw new Error("no event arrived before the deadline");
        if (chunk.done) throw new Error("the stream ended");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}
