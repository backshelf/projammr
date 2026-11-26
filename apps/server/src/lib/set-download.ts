import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { saveFile } from "./dit.js";
import { contentDisposition } from "./serve-file.js";

/** The OpenAPI description of a set download's 200, shared by every route that serves one. */
export const SET_FILE_RESPONSE = {
  description: "The set file",
  content: {
    "application/gzip": { schema: { type: "string", format: "binary" } },
  },
} as const;

/**
 * A save's `.als` as dit checks it out, named after its session: the gzipped
 * set rebuilt from the stored objects, or a raw save's file verbatim. A save
 * whose content is not stored answers 409; a rebuild that fails is a server
 * error rather than a partial file. `subject` and `id` name what was asked for
 * in those messages ("commit", 7).
 */
export async function setFile(
  subject: "commit" | "save",
  id: number,
  download: { saveId: number; contentState: string }
): Promise<Uint8Array> {
  if (download.contentState !== "stored") {
    throw new HTTPException(409, {
      message: `The ${subject}'s content is not stored (${download.contentState})`,
    });
  }

  try {
    return await saveFile(download.saveId);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`could not rebuild the set of ${subject} ${id}: ${why}`, {
      cause: error,
    });
  }
}

/** {@link setFile} as the download response, named after the session. */
export async function setFileResponse(
  c: Context,
  subject: "commit" | "save",
  id: number,
  download: { saveId: number; sessionName: string; contentState: string }
): Promise<Response> {
  const file = await setFile(subject, id, download);
  return c.body(new Uint8Array(file), 200, {
    "Content-Type": "application/gzip",
    "Content-Disposition": contentDisposition(
      "attachment",
      `${download.sessionName}.als`
    ),
  });
}
